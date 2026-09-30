# -*- coding: utf-8 -*-
"""Rebuild PrometricPrep.apk from apkbuild/ using the local Android toolchain.

Pipeline: aapt2 compile+link (resources + assets) -> javac -> d8 ->
add classes.dex -> zipalign -> apksigner (debug keystore).
"""
import os
import shutil
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(ROOT, "build")
BT = os.path.join(ROOT, "tools", "android-14")          # build-tools
PLATFORM_JAR = os.path.join(ROOT, "tools", "android-34", "android.jar")
JDK = os.path.join(ROOT, "tools", "jdk-17.0.20.1+1")
JAVA_HOME = JDK
ENV = {**os.environ, "JAVA_HOME": JDK}
JAVA = os.path.join(JDK, "bin", "java.exe")
JAVAC = os.path.join(JDK, "bin", "javac.exe")
KEYTOOL = os.path.join(JDK, "bin", "keytool.exe")
KEYSTORE = os.path.join(BUILD, "debug.keystore")
KS_PASS = "android"

def run(cmd, **kw):
    print("+", " ".join(os.path.relpath(c, ROOT) if c.startswith(ROOT) else c for c in cmd))
    r = subprocess.run(cmd, cwd=ROOT, env=ENV, capture_output=True, text=True, **kw)
    if r.returncode != 0:
        print(r.stdout)
        print(r.stderr, file=sys.stderr)
        sys.exit("command failed: " + cmd[0])
    if r.stdout.strip():
        print(r.stdout.strip()[-800:])

def main():
    for d in ("gen", "classes", "dexout"):
        shutil.rmtree(os.path.join(ROOT, d), ignore_errors=True)
        os.makedirs(os.path.join(ROOT, d), exist_ok=True)

    # 1. compile resources
    res_zip = os.path.join(BUILD, "res.zip")
    if os.path.exists(res_zip):
        os.remove(res_zip)
    run([os.path.join(BT, "aapt2.exe"), "compile",
         "--dir", os.path.join(ROOT, "res"),
         "-o", res_zip])

    # 2. link base apk (resources + assets + manifest), emit R.java
    base = os.path.join(BUILD, "unsigned.apk")
    if os.path.exists(base):
        os.remove(base)
    run([os.path.join(BT, "aapt2.exe"), "link",
         "-o", base,
         "-I", PLATFORM_JAR,
         "--manifest", os.path.join(ROOT, "AndroidManifest.xml"),
         "-A", os.path.join(ROOT, "assets"),
         "--java", os.path.join(ROOT, "gen"),
         "--auto-add-overlay",
         res_zip])

    # 3. compile java
    run([JAVAC, "-source", "11", "-target", "11",
         "-classpath", PLATFORM_JAR,
         "-d", os.path.join(ROOT, "classes"),
         os.path.join(ROOT, "gen", "com", "prometric", "prep", "R.java"),
         os.path.join(ROOT, "src", "com", "prometric", "prep", "MainActivity.java")])

    # 4. dex
    class_files = []
    for dirpath, _, files in os.walk(os.path.join(ROOT, "classes")):
        class_files.extend(os.path.join(dirpath, f) for f in files if f.endswith(".class"))
    run([os.path.join(BT, "d8.bat"), "--release",
         "--lib", PLATFORM_JAR,
         "--output", os.path.join(ROOT, "dexout"),
         *class_files])

    # 5. add classes.dex into the apk
    with zipfile.ZipFile(base, "a") as z:
        z.write(os.path.join(ROOT, "dexout", "classes.dex"), "classes.dex")

    # 6. zipalign
    aligned = os.path.join(BUILD, "aligned_new.apk")
    if os.path.exists(aligned):
        os.remove(aligned)
    run([os.path.join(BT, "zipalign.exe"), "-f", "4", base, aligned])

    # 7. sign (fresh debug keystore if missing)
    if not os.path.exists(KEYSTORE):
        run([KEYTOOL, "-genkeypair", "-v",
             "-keystore", KEYSTORE,
             "-storepass", KS_PASS, "-keypass", KS_PASS,
             "-alias", "prometric",
             "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000",
             "-dname", "CN=Prometric Prep, OU=Dev, O=Prometric, L=Cairo, C=EG"])
    final = os.path.join(BUILD, "PrometricPrep-v4.apk")
    if os.path.exists(final):
        os.remove(final)
    shutil.copy(aligned, final)
    run([os.path.join(BT, "apksigner.bat"), "sign",
         "--ks", KEYSTORE, "--ks-pass", "pass:" + KS_PASS,
         "--out", final, aligned])
    run([os.path.join(BT, "apksigner.bat"), "verify", "--print-certs", final])
    print("OK ->", final)

if __name__ == "__main__":
    main()
