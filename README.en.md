[中文](README.md) | [English](README.en.md)

# WhatsApp Assistant · Free Local Edition 2.3.8

A Chrome / Edge extension for **WhatsApp Web**, offering chat backups, voice exports, quick replies, contact organization, bulk messaging, and screen privacy controls. This is an independent third-party tool, not an official WhatsApp or Meta product.

## Download and installation

1. Download the extension ZIP from [Releases](https://github.com/liushuaiye2602141602-cmyk/WA-Assistant-Free/releases/latest) and extract it to a permanent folder.
2. In Chrome, open `chrome://extensions`; in Edge, open `edge://extensions`.
3. Enable **Developer mode**, then select **Load unpacked**.
4. Select the folder that **directly contains `manifest.json`**. Release archives use `WA-Assistant-Free`; GitHub source archives may have a different folder name.
5. Disable conflicting WhatsApp extensions, open [WhatsApp Web](https://web.whatsapp.com/), sign in, and refresh the page.
6. Click the green clock on the right side of the page, or select “打开助手面板” (Open assistant panel) in the extension popup.

To update, replace the files in the original extension folder, reload the extension on the extensions page, and refresh WhatsApp Web. Verify that the version is **2.3.8**. Avoid uninstalling first, as this may erase local data.

For detailed instructions, see the [user guide (Chinese)](使用说明.md).

## Main features

| Feature | What it does | Limitations |
| --- | --- | --- |
| Chat backups | Exports ZIP, HTML, Markdown, TXT, and JSON, with optional media | Only accessible records and downloadable media can be exported; complete history is not guaranteed |
| Voice exports | Saves audio in ZIP archives; standalone HTML can embed audio for playback | Standalone MD/TXT/JSON exports do not contain audio files |
| Quick replies | Manages saved replies and inserts them into the input box while preserving drafts | Sending is manual; keyword-based automatic replies are not included |
| Contact organization | Reads contact categories and members of multiple groups, deduplicates by number/ID, and exports CSV/XLSX | Labels, numbers, and group information depend on account and interface visibility |
| Bulk messaging | Imports recipients, substitutes fields, supports attachments, recording, buttons, previews, scheduling, and task reports | Recipients must consent; interface submission does not mean delivery or reading |
| Automatic opt-out | Watches keywords in personal chats and excludes recipients from later sends per account | Checks the latest 30 messages before sending; older or unsynchronized requests may be missed |
| Screen privacy | Blurs messages, names, avatars, media, and other page content | Affects local display only; it is not encryption |

Imported phone numbers must be in the first column. Recommended headers are `phone,name,company`. XLSX import reads the first worksheet and accepts files up to 20 MB. Attachments are limited to 16 MB each and 32 MB in total; recording is limited to two minutes.

Before first use, export a ZIP backup and test with a small number of consenting recipients. Generate and review a preview before sending. Deleting a chat does not recall messages and may remove existing local history.

## Highlights in 2.3.8

- Fixes popup actions being ignored by the background handler, restricts supported commands, and improves missing-response and error reporting.
- Prevents an imported `id` field from overriding normalized recipient IDs.
- Strengthens XLSX file boundary, decompression size, and cell coordinate checks.
- Validates attachment structures before task creation and execution.
- Adds keyboard selection and focus preservation to chat lists, with additional popup and XLSX tests.

This repository also retains the bilingual disclaimer and its popup link.

## Disclaimer and languages

Select “免责声明 / Disclaimer” in the extension popup, or open [disclaimer.html](disclaimer.html) in a browser after extracting the files. Click **中文 / English** to switch languages; the page remembers your choice.

**The disclaimer switch changes only the disclaimer language. The extension UI and operating guide are primarily in Chinese.** Use the links at the top of this README to switch the project introduction between Chinese and English. GitHub file preview does not execute the disclaimer switcher; download and open the HTML page instead.

Follow applicable laws and platform terms, obtain recipient consent, and honor opt-out requests. This tool does not guarantee avoidance of account restrictions, message delivery, or recovery of deleted records.

## Data and operating requirements

Settings, quick replies, tasks, attachments, reports, and opt-out lists are stored locally in the browser extension. Exports are downloaded to your computer. WhatsApp operations and media downloads still require network access; “local edition” does not mean fully offline operation.

Sending cannot run while the browser is closed or the computer is asleep. Background tasks require a running browser, the account bound to the task, and a ready page interface. Scheduled execution may be delayed. Uninstalling the extension, clearing browser data, or changing browser profiles may erase local data. Unified settings backup and one-click data cleanup are not currently available.

## Validation and limitations

The project includes eight tests from the supplied package and one disclaimer language-switching test. They cover simulated interfaces, task recovery, media exports, quick replies, UI, popup behavior, and XLSX. Browser tests use Edge; Playwright paths in the tests depend on the original environment and need adjustment on other computers.

These tests do not constitute validation with a real WhatsApp account. Sending, deletion, button messages, media downloads, and group receipts still require small-scale live verification. WhatsApp changes may break functionality. Page event bridge security boundaries, memory use for large files, and local data cleanup still need improvement.

CRM integration, concurrent use of multiple accounts, keyword-based automatic replies, contact search, and chat filtering by date are not included.

Third-party components and license files are retained in `libs/`. No unified open-source license has been declared for all project code, and redistribution rights for the original package still need verification. Public download does not grant unrestricted commercial-use rights.
