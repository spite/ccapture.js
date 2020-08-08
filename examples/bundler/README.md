# How to test NPM package
This demo is to test that package works with NPM and Parcel (or any other bundler).
To test this locally you need to link `ccapture.js` to your file system repository instead of NPM. Skip this step if you want to test package from NPM directly.
```
cd ~/ccapture.js/    # go into the repo directory
npm link             # creates global link
cd ~/ccapture.js/examples/bundler/   # go into this demo directory.
npm link ccapture.js  # link-install the package for bundling
```
This will make bundler use your local copy of package as an NPM package.

To run demo just do:
```parcel index.html```
Or if you dont have it installed globally:
```npx parcel index.html```