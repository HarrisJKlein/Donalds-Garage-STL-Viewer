# Donald's Garage · STL Viewer

A free, static STL drag-and-drop viewer with a basic dark layout for your existing Notion Education site. Three.js STLLoader reads the chosen file in the visitor's browser. GitHub Pages hosts the viewer; Notion continues hosting Donald's Garage.

**Previewing is not submitting. The separate native Notion upload form is not integrated.** Visitors must choose their file again in that form to submit it. This viewer neither reads files from the form nor writes responses, files, or thumbnails into Notion.

## Publish on GitHub Pages — no paid plan or backend

1. Extract `donalds-garage-stl-viewer.zip` on your computer.
2. Sign in to [GitHub](https://github.com/) with a free account. Create a **new public repository** named `donalds-garage-stl-viewer`. Select **Add a README file** so the repository has a `main` branch. Public repository hosting is the GitHub Free route.
3. Open the repository's **Code** tab, choose **Add file → Upload files**, and drag in the **contents** of the extracted folder. Include `vendor/` and `samples/` with their files. Replace the initial README with this one. Commit the upload to `main`.
4. Confirm that `index.html` appears at the **top level** of the repository alongside `app.js`, `styles.css`, and `vendor/`. Do not upload just the ZIP or nest everything inside another folder.
5. Open **Settings → Pages**. Under **Build and deployment**, choose **Source → Deploy from a branch**. Select **main** and **/(root)**, then click **Save**.
6. Wait for GitHub to finish publishing. Check the repository's **Actions** tab if needed, then return to **Settings → Pages** and copy the live site URL shown there. Its usual form is:

   `https://YOUR-GITHUB-USERNAME.github.io/donalds-garage-stl-viewer/`

   Replace the username; this is an example, not an already-published address. Use GitHub's actual URL if it differs.
7. Open that HTTPS URL in a browser. The gray demo gear should appear. Choose or drop an STL and try rotating and zooming it before embedding.

There is no build command, dependency installation, server application, API key, database, paid domain, or paid viewer subscription. Three.js is included in the download. GitHub Pages supports public repositories on GitHub Free; ordinary platform usage limits still apply. Keep the existing Notion Education site and use the supplied `github.io` address for a $0 setup. [GitHub Pages availability](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site), [branch publishing instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

## Embed inside the existing Notion site

1. Open the **editable Notion page** for Donald's Garage where the preview should appear, ideally beside or just above your existing upload form or its link.
2. On a new line, type **`/embed`** and select **Embed**.
3. Choose **Embed link**, paste the viewer's published **HTTPS GitHub Pages URL**, and confirm **Embed link**. Paste the live webpage URL, not the GitHub repository URL, a ZIP, an STL URL, or HTML `<iframe>` code.
4. Resize the embed using its edges. Start with **800–1,000 px wide and about 950 px tall**; use the page's **Full width** option if helpful. The layout is a simple single column. Narrow embeds may need more height or scrolling.
5. Keep the separate Notion upload form below it, with an instruction such as: **“Preview your STL above, then choose the same STL in the form below to submit your request.”**
6. Publish/update the existing Notion page using your normal workflow. Open the **public Notion Site URL** in a private/incognito browser window and test the embedded file picker, drag-and-drop, and touch controls. Confirm the form still accepts a submission independently.

Notion documents URL-based embeds and resizing. The viewer has no login requirement or frame-blocking policy. The actual published embed must still be checked in your Notion page; it has not been tested against your account. If Notion shows a bookmark, recreate the block with `/embed` and **Embed link**. If an embed fails, first verify the live Pages URL on its own, then retry the block; add an **Open STL viewer** link as a fallback if your Notion client prevents loading it. [Notion embed documentation](https://www.notion.com/help/embed-and-connect-other-apps).

## Use the viewer

- Drag **one `.stl` file** into the viewer, or use the native **STL file** picker (usually labeled **Choose File** or **Browse** by your browser). Binary and ASCII STL are supported, including an uppercase `.STL` extension.
- Drag to **orbit**. Scroll or pinch to **zoom**. Right-drag or use two fingers to **pan**. On a focused preview, arrow keys orbit, `+`/`−` zoom, and `Home` fits the model.
- **Fit view** recenters the model. **Wireframe** and **Auto-rotate** toggle those views. Auto-rotation starts only when requested and pauses when the viewer is off-screen or the browser tab is hidden.
- **Save image** downloads the current 3D view as a PNG on the visitor's device. It does not attach the image to Notion. The saved image is the rendered model view, without the page's text or controls.
- **Clear** removes the current model. **Try the demo model** restores the included example.
- Filenames, triangle counts, file sizes, and original X × Y × Z dimensions are shown. **STL does not encode units**; the viewer does not assume millimeters or inches. The camera uses Z-up, a common CAD convention.

Limits: **50 MiB per file** and **1,000,000 triangles**. A background worker reads and validates files, with a 30-second timeout. Very large or complicated models may need a simpler export, especially on phones. Binary files must have a complete, standard-length triangle table; malformed exports should be re-exported from the CAD app. The viewer displays geometry; it does not verify printability or produce print quotes.

## What stays local

Selected STL bytes are read using the browser's File API, passed to a local Web Worker, and rendered using Three.js STLLoader and OrbitControls. They are **never sent to GitHub, Notion, or an upload server by this viewer**. There is no form submission code, telemetry, analytics, storage API, or third-party script request. The original source file is not changed.

The published viewer still downloads its HTML, CSS, JavaScript, and included demo STL from GitHub Pages. GitHub serves those public assets; Notion and its embed service serve the surrounding site. This local-file promise concerns the visitor's selected model, not ordinary hosting connections. Refreshing starts over with the demo; there is no persistent or shareable upload. Clear/page navigation releases the active parser and model resources as applicable.

## Files to keep together

```text
index.html                 Page, accessible controls, local-only content policy
styles.css                 Basic responsive dark styling
boot.js                    Startup and useful failure messages
app.js                     Scene, orbit/zoom controls, local file handling
stl-worker.js              STLLoader parsing off the main UI thread
stl-validation.js          File, triangle-count, and coordinate checks
favicon.svg                Donald's Garage mark
.nojekyll                  Static Pages publishing marker
samples/garage-demo.stl    Included example gear plate
vendor/                    Three.js 0.180.0, STLLoader, OrbitControls, license
README.md                  This setup and usage guide
THIRD-PARTY.md             Dependency sources and license information
LICENSE                    MIT license for the original viewer files
```

All asset paths are relative, so the viewer works in a Pages repository subdirectory. Do not rename or omit the `vendor` files. If `.nojekyll` is hidden in your file manager, use “show hidden files” before uploading; the other files do not require a Jekyll build.

## Optional local preview

Double-clicking `index.html` is **not supported**: browsers restrict modules and workers on `file://` pages. Deploy to GitHub Pages, or use a local static HTTP server. If Python 3 is already installed, open a terminal in the extracted folder and run:

```text
python -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000/` in a current browser. Stop the server with `Ctrl+C`. This only serves the static files locally; it adds no upload endpoint. Python is optional and is not needed for GitHub Pages deployment.

## Troubleshooting and updates

- **404 / wrong page:** Ensure `index.html` is in the repository root, Pages uses `main` + `/(root)`, and the Pages deployment finished. Use the actual Pages URL, including the repository name.
- **Viewer cannot start:** Use a current Chrome, Edge, Firefox, or Safari with WebGL 2/hardware acceleration available. Confirm all `vendor` files were uploaded. Reload after publishing. JavaScript must be enabled.
- **STL reader cannot start:** Confirm `stl-worker.js` and `stl-validation.js` were uploaded beside `app.js`. Serve over HTTPS or local HTTP, not `file://`.
- **File rejected:** Choose a single nonempty STL within the limits. Re-export a damaged file, or lower mesh resolution. The previous valid preview remains visible after an invalid selection.
- **No thumbnail appears in Notion's response database:** Expected. The native Notion upload form is **not integrated**. Visitors select a file separately in the viewer and in the form.
- **Updating later:** Commit changed site files to the same repository/branch. GitHub Pages redeploys them. Keep the same live URL in Notion; refresh the published Notion page after deployment.

Three.js supports binary and ASCII STL parsing through STLLoader; OrbitControls supplies orbit, zoom, and pan. [STLLoader documentation](https://threejs.org/docs/pages/STLLoader.html), [OrbitControls documentation](https://threejs.org/docs/pages/OrbitControls.html).
