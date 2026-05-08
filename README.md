## Overview
Uses SAM3 to segment images in Figma.

## TODO
- [ ] allow selecting point clicks to specify specific parts of the image are foreground or background
- [ ] allow tuning threshold used by SAM3, exposing mask-logit threshold as a slider to allow fine tuning how precise masks are
- mask post processing (probably want toggles for these in the UI in case they lead to problems on specific prompts):
  - [ ] Douglas-Peuker path simplification with epsilon 1-2px before sending vector back to Figma, so that the resulting vector is more hand editable
  - don't really understand these, would probably want toggles too because they could cause their own problems in particular cases
    - Hole-fill: flood-fill background from image edges, anything still 0 inside is a hole, set to 1.
    - Morphology: 1-2 px erode-then-dilate (opening) to drop noise; dilate-then-erode (closing) to seal gaps.
    - Gaussian smooth the logit before thresholding for cleaner edges.
- [ ] allow exporting rects/point selections/prompts back to Figma as named shapes/text fields and allow re-importing them to allow saving prompts so that it's possible to refine in the future as desired

---

Below are the steps to get your plugin running. You can also find instructions at:

  https://www.figma.com/plugin-docs/plugin-quickstart-guide/

This plugin template uses Typescript and NPM, two standard tools in creating JavaScript applications.

First, download Node.js which comes with NPM. This will allow you to install TypeScript and other
libraries. You can find the download link here:

  https://nodejs.org/en/download/

Next, install TypeScript using the command:

  npm install -g typescript

Finally, in the directory of your plugin, get the latest type definitions for the plugin API by running:

  npm install --save-dev @figma/plugin-typings

If you are familiar with JavaScript, TypeScript will look very familiar. In fact, valid JavaScript code
is already valid Typescript code.

TypeScript adds type annotations to variables. This allows code editors such as Visual Studio Code
to provide information about the Figma API while you are writing code, as well as help catch bugs
you previously didn't notice.

For more information, visit https://www.typescriptlang.org/

Using TypeScript requires a compiler to convert TypeScript (code.ts) into JavaScript (code.js)
for the browser to run.

We recommend writing TypeScript code using Visual Studio code:

1. Download Visual Studio Code if you haven't already: https://code.visualstudio.com/.
2. Open this directory in Visual Studio Code.
3. Compile TypeScript to JavaScript: Run the "Terminal > Run Build Task..." menu item,
    then select "npm: watch". You will have to do this again every time
    you reopen Visual Studio Code.

That's it! Visual Studio Code will regenerate the JavaScript file every time you save.
