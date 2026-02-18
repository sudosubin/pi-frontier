import path from "node:path";

const scope = path.basename(process.cwd());

export default {
  git: {
    requireBranch: ["main"],
    requireCleanWorkingDir: true,
    commitsPath: ".",
    commitMessage: "release(${npm.name}): v${version}",
    tagName: "${npm.name}@${version}",
    tagAnnotation: "${npm.name}@${version}",
    tagMatch: "${npm.name}@*",
    getLatestTagFromAllRefs: true,
    pushArgs: ["--follow-tags"],
  },
  npm: {
    publish: true,
    skipChecks: true,
  },
  github: {
    release: true,
    releaseName: "${npm.name}@${version}",
    autoGenerate: false,
  },
  plugins: {
    "@release-it/conventional-changelog": {
      preset: {
        name: "conventionalcommits",
        scope,
        scopeOnly: true,
        preMajor: true,
        bumpStrict: true,
      },
      tagOpts: { prefix: `${scope}@` },
      context: { linkCompare: false },
      infile: "CHANGELOG.md",
    },
  },
};
