import express from 'express';
import cors from 'cors';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { v4 as uuid } from 'uuid';

const execFileAsync = promisify(execFile);
const app = express();
const PORT = Number(process.env.PORT || 10000);
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const jobs = new Map();
const artifacts = new Map();

app.use(cors({
  origin: CORS_ORIGIN === '*'
    ? true
    : CORS_ORIGIN.split(',').map(s => s.trim()),
  credentials: true
}));

app.use(express.json({ limit: '2mb' }));

const safe = value =>
  String(value ?? '').replace(/[^a-zA-Z0-9._-]/g, '_');

const shellEnv = {
  ...process.env,
  HOME: process.env.HOME || '/tmp'
};

function validate(c) {
  const url = new URL(c.url);

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('URL faqat http yoki https bo‘lishi kerak');
  }

  if (
    !/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(
      c.packageName
    )
  ) {
    throw new Error('Noto‘g‘ri packageName');
  }

  if (!/^\d+$/.test(String(c.versionCode))) {
    throw new Error('versionCode noto‘g‘ri');
  }

  if (!/^\d+(\.\d+)*$/.test(String(c.versionName))) {
    throw new Error('versionName noto‘g‘ri');
  }
}

function update(job, patch) {
  Object.assign(job, patch);
}

async function writeAndroidProject(root, c) {
  const pkgPath = c.packageName.replaceAll('.', '/');
  const activityDir = path.join(
    root,
    'app/src/main/java',
    pkgPath
  );

  const resDir = path.join(root, 'app/src/main/res');

  await fs.mkdir(activityDir, { recursive: true });

  for (const d of [
    'drawable',
    'drawable-nodpi',
    'values'
  ]) {
    await fs.mkdir(path.join(resDir, d), {
      recursive: true
    });
  }

  const label = String(c.appName || 'My App')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const orientation =
    c.orientation === 'landscape'
      ? 'landscape'
      : c.orientation === 'portrait'
        ? 'portrait'
        : 'unspecified';

  await fs.writeFile(
    path.join(resDir, 'values/styles.xml'),
`<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme"
        parent="android:style/Theme.Material.Light.NoActionBar">
        <item name="android:fontFamily">sans</item>
        <item name="android:colorAccent">#1f5ae8</item>
        <item name="android:statusBarColor">#1f5ae8</item>
        <item name="android:navigationBarColor">#0d47a1</item>
    </style>
</resources>`
  );

  await fs.writeFile(
    path.join(root, 'settings.gradle'),
`pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(
        RepositoriesMode.FAIL_ON_PROJECT_REPOS
    )
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = 'GeneratedApp'
include ':app'`
  );

  await fs.writeFile(
    path.join(root, 'build.gradle'),
`plugins {
    id 'com.android.application' version '8.7.3' apply false
}`
  );

  await fs.writeFile(
    path.join(root, 'gradle.properties'),
`org.gradle.jvmargs=-Xmx512m
android.useAndroidX=true`
  );

  await fs.writeFile(
    path.join(root, 'app/build.gradle'),
`plugins {
    id 'com.android.application'
}

android {
    namespace '${c.packageName}'
    compileSdk 35

    defaultConfig {
        applicationId '${c.packageName}'
        minSdk 23
        targetSdk 35
        versionCode ${Number(c.versionCode)}
        versionName '${c.versionName}'
    }
}`
  );

  await fs.writeFile(
    path.join(
      root,
      'app/src/main/AndroidManifest.xml'
    ),
`<?xml version="1.0" encoding="utf-8"?>
<manifest
    xmlns:android="http://schemas.android.com/apk/res/android">

    <uses-permission
        android:name="android.permission.INTERNET" />

    <application
        android:theme="@style/AppTheme"
        android:label="${label}"
        android:usesCleartextTraffic="true">

        <activity
            android:name=".MainActivity"
            android:screenOrientation="${orientation}"
            android:exported="true">

            <intent-filter>
                <action
                    android:name="android.intent.action.MAIN" />

                <category
                    android:name="android.intent.category.LAUNCHER" />
            </intent-filter>

        </activity>

    </application>

</manifest>`
  );

  const escapedUrl = String(c.url)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');

  const activity =
`package ${c.packageName};

import android.app.Activity;
import android.os.Bundle;
import android.graphics.Color;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;

public class MainActivity extends Activity {

    WebView web;

    @Override
    public void onCreate(Bundle b) {
        super.onCreate(b);

        web = new WebView(this);
        web.setBackgroundColor(Color.WHITE);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);

        web.setWebViewClient(new WebViewClient());
        web.setWebChromeClient(new WebChromeClient());

        web.loadUrl("${escapedUrl}");

        setContentView(web);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }
}`;

  await fs.writeFile(
    path.join(activityDir, 'MainActivity.java'),
    activity
  );
}

async function buildJob(job, config, target) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), `apktop-${job.id}-`)
  );

  try {
    update(job, {
      status: 'running',
      stepIndex: 0
    });

    await writeAndroidProject(root, config);

    update(job, {
      stepIndex: 1
    });

    const gradle =
      process.env.GRADLE_BIN || 'gradle';

    const task =
      target === 'aab'
        ? ':app:bundleRelease'
        : ':app:assembleRelease';

    await execFileAsync(
      gradle,
      [
        '--no-daemon',
        task
      ],
      {
        cwd: root,
        env: shellEnv,
        timeout: 8 * 60 * 1000,
        maxBuffer: 4 * 1024 * 1024
      }
    );

    update(job, {
      stepIndex: 3
    });

    const built =
      target === 'aab'
        ? path.join(
            root,
            'app/build/outputs/bundle/release/app-release.aab'
          )
        : path.join(
            root,
            'app/build/outputs/apk/release/app-release.apk'
          );

    const output = path.join(
      root,
      safe(
        config.outputFileName ||
        (target === 'aab'
          ? 'app.aab'
          : 'app.apk')
      )
    );

    await fs.copyFile(built, output);

    artifacts.set(job.id, {
      file: output,
      name: path.basename(output),
      contentType:
        target === 'aab'
          ? 'application/octet-stream'
          : 'application/vnd.android.package-archive'
    });

    update(job, {
      status: 'ready',
      stepIndex: 3,
      artifactUrl: `/artifacts/${job.id}`
    });

  } catch (e) {
    console.error(e);

    update(job, {
      status: 'failed',
      errorMessage:
        e?.stderr ||
        e?.message ||
        'Build xatosi'
    });
  }
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'apktop-build-server'
  });
});

app.post('/builds/:target', (req, res) => {
  const { target } = req.params;

  if (!['apk', 'aab'].includes(target)) {
    return res.status(404).json({
      message: 'Noto‘g‘ri build turi'
    });
  }

  try {
    validate(req.body);
  } catch (e) {
    return res.status(400).json({
      message: e.message
    });
  }

  const id = uuid();

  const job = {
    id,
    status: 'queued',
    stepIndex: 0,
    artifactUrl: null,
    errorMessage: null
  };

  jobs.set(id, job);

  void buildJob(
    job,
    req.body,
    target
  );

  res.status(202).json(job);
});

app.get('/builds/:id', (req, res) => {
  const job = jobs.get(req.params.id);

  if (!job) {
    return res.status(404).json({
      message: 'Build topilmadi'
    });
  }

  res.json(job);
});

app.get('/artifacts/:id', async (req, res) => {
  const a = artifacts.get(req.params.id);

  if (!a) {
    return res.status(404).json({
      message:
        'Fayl tayyor emas yoki server qayta ishga tushgan'
    });
  }

  res.download(
    a.file,
    a.name,
    {
      headers: {
        'Content-Type': a.contentType
      }
    }
  );
});

app.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      `APKTOP build server listening on ${PORT}`
    );
  }
);
