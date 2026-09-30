# -*- coding: utf-8 -*-
"""Prometric Prep — Windows desktop wrapper (pywebview / Edge WebView2)."""
import os
import sys
import webview


def resource_dir():
    base = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, "app")


def on_closing():
    return True


class Api:
    def save_pdf(self, filename, b64):
        """Save an exported exam report via a native Save-As dialog."""
        import base64
        try:
            import tkinter as tk
            from tkinter import filedialog
            root = tk.Tk()
            root.withdraw()
            try:
                root.attributes("-topmost", True)
            except Exception:
                pass
            path = filedialog.asksaveasfilename(
                defaultextension=".pdf",
                initialfile=filename,
                filetypes=[("PDF file", "*.pdf")],
                title="Export exam report",
            )
            root.destroy()
            if not path:
                return None
            with open(path, "wb") as f:
                f.write(base64.b64decode(b64))
            return path
        except Exception:
            return None


def main():
    index = os.path.join(resource_dir(), "index.html")
    webview.create_window(
        "Prometric Prep — Question Bank",
        url=index.replace("\\", "/"),
        width=1280,
        height=880,
        min_size=(420, 640),
        background_color="#f6f1e7",
        js_api=Api(),
    )
    # private_mode=False keeps localStorage (history, best scores) between runs
    webview.start(private_mode=False, storage_path=os.path.join(
        os.environ.get("APPDATA", os.path.expanduser("~")), "PrometricPrep"))


if __name__ == "__main__":
    main()
