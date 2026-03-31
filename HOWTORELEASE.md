# How the release process works

This repository uses _changesets_ and the changeset action to handle releasing. This only works for packages that have already been released.

1. run `pnpm exec changeset` for each commit that has code changes and tag which packages were changed. You may need to indicate a major/minor/patch update, or you can choose one and then edit the .md file that gets added to the `.changesets` folder after.
2. when you push your commit, there is a plugin that checks your PR for changesets and
   summarises them. If they aren't included, you can include a blank changeset by typing `pnpm exec changeset add --empty`.
3. when the PR merges, changesets will create a new PR (or update an existing one) indicating what all the things are to be released and what their version numbers will be. DON'T manually bump version numbers yourself.
4. once you are happy with all the changes and wish to do a release, merge that MR, the packages will be released and it will update `main` having removed the changeset dross.

The `pnpm publish -r` process checks for any packages that have not been released to npm and will release those in the appropriate order. Because of this, you don't need to worry about packages being released that were changed (or not changed).

For packages that have not yet been published to NPM, you need to do it manually from your
own machine, and then go to the repository on npmjs and set up the OIDC config to point back to this repository using the `release.yml` workflow. Subsequent releases are then
handled by the changeset mechanism.

You must indicate these are not to be handled by publish using `"private": true` in the `package.json` to prevent pnpm from trying to release them. Once they are to be released, make sure they have a `repository` and `publishConfig` section:

```json
  "publishConfig": {
    "provenance": true,
    "access": "public"
  },
```
