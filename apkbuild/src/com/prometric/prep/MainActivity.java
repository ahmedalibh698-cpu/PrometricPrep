package com.prometric.prep;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

public class MainActivity extends Activity {
    private static final int FILE_CHOOSER_REQUEST = 1001;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // let the app use the full screen around camera notches (the web app pads
        // with env(safe-area-inset-*) via viewport-fit=cover)
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        webView = new WebView(this);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        // lay the page out at the device width and scale it to fit on first paint,
        // so every screen size/density starts with the whole view in frame
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setAllowFileAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        webView.setHorizontalScrollBarEnabled(false);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                // hard guarantee against sideways panning on any device: clip the
                // page at the root so it can only scroll up and down
                view.evaluateJavascript(
                        "document.documentElement.style.overflowX='clip';" +
                        "document.body.style.overflowX='clip';", null);
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }
        });
        webView.addJavascriptInterface(new PdfSaver(), "AndroidSaver");
        webView.loadUrl("file:///android_asset/index.html");
        setContentView(webView);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST && filePathCallback != null) {
            filePathCallback.onReceiveValue(
                    WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            filePathCallback = null;
        } else {
            super.onActivityResult(requestCode, resultCode, data);
        }
    }

    /** Bridge the web app calls as window.AndroidSaver.savePdf(name, base64). */
    private class PdfSaver {
        @JavascriptInterface
        public void savePdf(String name, String b64) {
            byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
            String path = writeToDownloads(name, bytes);
            runOnUiThread(() -> Toast.makeText(MainActivity.this,
                    path == null ? "Could not save the PDF"
                        : "Saved to Downloads: " + path,
                    Toast.LENGTH_LONG).show());
        }
    }

    private String writeToDownloads(String name, byte[] bytes) {
        String safe = (name == null || name.isEmpty() ? "exam-report" : name);
        if (!safe.toLowerCase().endsWith(".pdf")) safe += ".pdf";
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.MediaColumns.DISPLAY_NAME, safe);
                values.put(MediaStore.MediaColumns.MIME_TYPE, "application/pdf");
                values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
                Uri uri = getContentResolver().insert(
                        MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) return null;
                try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                    os.write(bytes);
                }
                return Environment.DIRECTORY_DOWNLOADS + "/" + safe;
            }
            // Android 9 and older: public Downloads folder (app-specific dir as fallback)
            File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            File out = new File(dir, safe);
            try (FileOutputStream fos = new FileOutputStream(out)) {
                fos.write(bytes);
            }
            return out.getAbsolutePath();
        } catch (Exception e) {
            try {
                File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                File out = new File(dir, safe);
                try (FileOutputStream fos = new FileOutputStream(out)) {
                    fos.write(bytes);
                }
                return out.getAbsolutePath();
            } catch (Exception ignored) {
                return null;
            }
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
