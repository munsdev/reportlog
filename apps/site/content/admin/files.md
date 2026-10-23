---
title: Files
description: Photos, video, audio and documents reporters send: whether the site takes them, the limits, how they are stored, and erasing one.
---

A site takes files only when an administrator says so. A fresh install starts with files off, and even then a logbook takes files only if one of its questions asks for them (the [file question kind](/docs/reference/question-kinds/)), and only while the site has somewhere to put them.

## What happens to a file

1. The reporter's browser uploads it while they fill in the form. A file question always asks the reporter for an address.
2. Every minute, the `files` job takes new uploads, **re-encodes** them, strips their metadata (where a photo was taken, the camera, the software), and **encrypts** the original under a key of its own. That key is itself encrypted under the site's `FILES_KEY`. Uploads that were never sent with a report are swept away.
3. When the report is filed, each file's fingerprint is part of what is sealed. The file itself is not, so it can be erased later without breaking the chain.
4. A moderator decides what happens to each file, separately from the report. See [Files and evidence](/docs/moderate/files-and-evidence/).

Optionally each file is scanned with ClamAV first (`CLAMAV_ENABLED`, which needs `clamd` on the server).

## Settings

Under **Logbooks and lists › File limits**:

- **Take files** or **Do not take files**, for the whole site.
- **Which kinds**: photos, video, audio and documents, or only some of them.
- **Limits**: how many files a report may carry, their total size, the size of each kind, the length of a video and the pages of a document.

Each logbook can narrow these for itself, never widen them: a kind the site does not take, the logbook cannot take either. A logbook's limits can change after launch, because they are not part of its questions.

## Where files are kept

On a server, files live in object storage (`FILES_STORAGE=s3` and the `S3_` settings): three buckets, for files not yet sent, files with a report, and the re-encoded copies. Before the site takes anybody's files, run the storage check once against your provider; the [install guide](/docs/operate/setting-up-a-server/) says how. Files are not in the database backups.

## Erasing a file

On the **Erase a file** screen (`/files/erase`, for administrators), type a report’s reference to see its files, and erase one. Erasing destroys the key the file was locked with, so nobody can ever open it again, this site included. Its fingerprint stays in the report, which still checks out. It cannot be undone.

This is the answer to a request to erase a file: the report stays sealed and checkable, and the file is gone.
