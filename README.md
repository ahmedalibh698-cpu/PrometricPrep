# Prometric Prep

Question-bank practice app for the Saudi Prometric licensing exam — 627 unique
questions from 7 source forms, paired with the official answer key. Ships as an
Android APK (WebView app), a Windows desktop EXE, and a plain web app.

## Layout

| Path | What it is |
|---|---|
| `app/` | The web app itself — `index.html`, `styles.css`, `app.js`, question data. Shared by all builds. |
| `apkbuild/` | Android wrapper: `AndroidManifest.xml`, `src/…/MainActivity.java` (WebView + PDF saver), `assets/` (copy of the web app), `build_apk.py` |
| `desktop/` | PyInstaller project for the Windows EXE (`desktop.py`, `PrometricPrep.spec`) |
| `PrometricPrep.apk` | Current signed Android build |
| `PrometricPrep.exe` | Current Windows build |
| `mcq prometric.docx` | Original source questions |

## Rebuilding the APK

`apkbuild/build_apk.py` drives the full pipeline (aapt2 → javac → d8 → zipalign → apksigner).
It expects a local toolchain in `apkbuild/tools/` (not committed): Android build-tools,
an `android-34` platform `android.jar`, and a JDK 17 — laid out as
`tools/android-14/`, `tools/android-34/`, `tools/jdk-17.0.20.1+1/`.
The debug keystore used for signing **is** committed (`apkbuild/build/debug.keystore`,
store password `android`) so updates keep installing over existing installs.

Web-app changes: edit `app/`, then copy `index.html`, `styles.css`, `app.js`
into `apkbuild/assets/` (they are kept in sync) and rebuild.
