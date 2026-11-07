#!/usr/bin/env python3
"""Compare two package directories using the installed Pi CLI, without LLM/network calls.

Example (run from pi-cursor-agent):
  python3 bench/startup.py --before /tmp/pi-load-speed-before --after . \
    --output /tmp/pi-load-speed-results

Both directories must resolve the same installed runtime dependencies. Each sample
uses a fresh Pi process and an isolated agent directory with a fresh model cache.
The OS/Jiti/Node disk caches are NOT cleared. One warmup per condition is excluded.
"""
import argparse
import json
import os
from pathlib import Path
import re
import statistics
import subprocess
import tempfile
import threading
import time


def run(pi, package, probe, output, label):
    with tempfile.TemporaryDirectory(prefix="cursor-load-speed-") as temporary:
        agent = Path(temporary)
        cache = agent / "cache" / "pi-cursor-agent"
        cache.mkdir(parents=True)
        (cache / "models.json").write_text(json.dumps({
            "models": [{"modelId": "composer-2", "displayName": "Composer 2"}],
            "lastUpdatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }))
        (agent / "settings.json").write_text('{"packages": []}')
        env = os.environ.copy()
        env.update(PI_CODING_AGENT_DIR=str(agent), PI_TIMING="1", PI_OFFLINE="1",
                   CURSOR_BENCH_ENTRY=str(package / "src" / "index.ts"),
                   CURSOR_BENCH_RESULT=str(agent / "probe.json"))
        env.pop("CURSOR_ACCESS_TOKEN", None)
        entry = Path(__file__).with_name("probe.ts") if probe else package / "src" / "index.ts"
        argv = [pi, "--mode", "rpc", "--no-session", "--offline", "--no-extensions", "-e", str(entry)]
        start = time.perf_counter()
        process = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True, env=env, cwd=temporary)
        errors = []
        reader = threading.Thread(target=lambda: errors.append(process.stderr.read()))
        reader.start()
        lines, ready_ms, request = [], None, None
        timer = threading.Timer(20, process.kill)
        timer.start()
        process.stdin.write('{"id":"ready","type":"get_state"}\n')
        process.stdin.flush()
        try:
            for line in process.stdout:
                lines.append(line)
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if record.get("id") == "ready":
                    assert record.get("success"), record
                    ready_ms = (time.perf_counter() - start) * 1000
                    if not probe:
                        break
                    process.stdin.write('{"id":"probe","type":"prompt","message":"/cursor-load-speed-probe"}\n')
                    process.stdin.flush()
                if record.get("id") == "probe":
                    assert record.get("success"), record
                    request = json.loads((agent / "probe.json").read_text())
                    break
            process.stdin.close()
            process.wait(timeout=10)
        finally:
            timer.cancel()
            if process.poll() is None:
                process.kill()
                process.wait()
            reader.join()
        stderr = "".join(errors)
        output.mkdir(parents=True, exist_ok=True)
        (output / f"{label}.stdout").write_text("".join(lines))
        (output / f"{label}.stderr").write_text(stderr)
        assert process.returncode == 0 and ready_ms is not None, (label, stderr)
        assert "Failed to load extension" not in stderr, stderr
        result = {"label": label, "ready_ms": ready_ms}
        if probe:
            assert request is not None, (label, lines, stderr)
            result.update(first_request_ms=request[0]["completed_ms"],
                          second_request_ms=request[1]["completed_ms"],
                          first_return_ms=request[0]["returned_ms"])
        else:
            timings = re.findall(r"^  .*src/index\.ts (?:module import|factory): (\d+)ms$", stderr, re.M)
            assert len(timings) == 2, (label, stderr)
            result["extension_ms"] = sum(map(int, timings))
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--before", type=Path, required=True)
    parser.add_argument("--after", type=Path, required=True)
    parser.add_argument("--pi", default="pi")
    parser.add_argument("--runs", type=int, default=9)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    packages = {"before": args.before.resolve(), "after": args.after.resolve()}
    samples = {name: {"startup": [], "request": []} for name in packages}
    for i in range(args.runs + 1):
        # Alternate order to reduce systematic drift; never run samples concurrently.
        names = list(packages) if i % 2 == 0 else list(reversed(packages))
        for name in names:
            for mode in ("startup", "request"):
                result = run(args.pi, packages[name], mode == "request", args.output,
                             f"{name}-{mode}-{i}")
                print(json.dumps(result), flush=True)
                if i:
                    samples[name][mode].append(result)
    summary = {}
    for name, modes in samples.items():
        summary[name] = {}
        for mode, records in modes.items():
            summary[name][mode] = {
                key: {"median": statistics.median(r[key] for r in records),
                      "min": min(r[key] for r in records), "max": max(r[key] for r in records)}
                for key in records[0] if key != "label"
            }
    # Keep shareable results independent of developer-specific checkout paths.
    payload = {"runs": args.runs, "warmups": 1,
               "packages": {"before": "<baseline export>", "after": "pi-cursor-agent"},
               "summary": summary, "samples": samples}
    (args.output / "results.json").write_text(json.dumps(payload, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
