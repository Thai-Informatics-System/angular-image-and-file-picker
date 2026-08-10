# angular-image-and-file-picker

An all-in-one **image and file upload/view** Angular component by **Thai Informatic Systems Co. Ltd.**, designed for modern enterprise applications. This library provides a highly customizable drag-and-drop or button-triggered upload UI, with seamless preview and viewer integration for files including images, PDFs, videos, Excel, and more.

[![npm version](https://img.shields.io/npm/v/@servicemind.tis/angular-image-and-file-picker)](https://www.npmjs.com/package/@servicemind.tis/angular-image-and-file-picker)
[![npm downloads](https://img.shields.io/npm/dm/@servicemind.tis/angular-image-and-file-picker)](https://www.npmjs.com/package/@servicemind.tis/angular-image-and-file-picker)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 🚀 Features

- ✅ Image and file upload with S3-style pre-signed URL handling
- ✅ Support for images, PDFs, Excel, CSV, videos, and raw files
- ✅ Built-in preview & viewer components
- ✅ Optional confirmation dialogs
- ✅ Fully customizable UI and dialog labels
- ✅ Support for standalone and module-based Angular apps
- ✅ Supports multiple uploads, size control, and compression toggle

---

## 📦 Installation

```bash
npm install @servicemind.tis/angular-image-and-file-picker
```

### Peer Dependencies

All of these are declared as peer dependencies and must be installed alongside the library:

```bash
npm install @angular/material @angular/cdk ngx-extended-pdf-viewer angularx-qrcode
```

`ngx-extended-pdf-viewer` powers the PDF preview and `angularx-qrcode` renders the pairing QR code for upload-from-phone. Both are required even if you don't use those features, because the library's NgModule imports them.

---

## 🧩 Module Setup

```ts
import { AngularImageAndFilePickerModule } from '@servicemind.tis/angular-image-and-file-picker';

@NgModule({
  imports: [AngularImageAndFilePickerModule]
})
export class MyFeatureModule {}
```

---

## ⚙️ Configuration Interfaces

### `UrlConfig`

```ts
export interface UrlConfig {
  getUploadUrl: string;
  attachToEntity: string;
  removeImage: string;
}
```

### `DialogConfig`

```ts
export interface DialogConfig {
  title: string;
  message: string | null;
  iconClass: string;
  icon: string;
  approveButtonText: string | null;
  approveButtonClass: string;
  cancelButtonText: string | null;
  cancelButtonClass: string;
}
```

---

## 🧠 Component: `<angular-image-and-file-picker>`

This is the main component that allows users to upload and preview files.

### ✅ Inputs

`urlConfig` is the only required input — it is declared `@Input({ required: true })`.

| Input | Type | Default | Description |
|---|---|---|---|
| `urlConfig` | `UrlConfig` | — | **Required.** API endpoints for upload, attach and delete |
| `entityType` | `string` | — | Type of the associated entity |
| `entityId` | `any` | — | Id of the associated entity |
| `type` | `'image' \| 'file'` | `'image'` | What the picker accepts |
| `viewType` | `'card' \| 'list' \| 'compact'` | `'card'` | Layout of the previews |
| `label` | `string \| null` | `null` | Upload label |
| `hint` | `string \| null` | `null` | Hint text below the control |
| `data` | `any` | — | Existing files to render |
| `accept` | `string` | `''` | Allowed file types, e.g. `.jpg,.png` |
| `isValidateMimeType` | `boolean` | `true` | Validate the real MIME type, not just the extension |
| `disabled` | `boolean` | `false` | Disable upload actions |
| `required` | `boolean` | `false` | Show the required indicator |
| `selectedId` | `any` | `null` | Pre-select a file by id |
| `options` | `OptionConfig \| null` | `null` | Visual and functional configuration |
| `previewOnly` | `boolean` | `false` | Render previews with no upload affordance |
| `previewInFlex` | `boolean` | `false` | Lay previews out with flex instead of grid |
| `imageItemClass` | `string` | `''` | Extra classes on each preview tile |
| `isAddUploadedFileInLastNode` | `boolean` | `false` | Append new uploads instead of prepending |
| `isEnableDeleteConfirmation` | `boolean` | `true` | Confirm before deleting |
| `deleteConfirmationMsg` | `string` | — | Override the confirmation text |
| `isEnableCapture` | `boolean` | `false` | Offer camera capture |
| `dialogConfig` | `DialogConfig` | — | Confirmation dialog labels and sizing |
| `enableDragNDropForUpload` | `boolean` | `false` | Accept files dropped onto the control |
| `enableDragNDrop` | `boolean` | `false` | Allow reordering previews by dragging |
| `isShowImageSequence` | `boolean` | `false` | Show the ordering index on each preview |
| `editTagButtonWhenDisabled` | `boolean` | `false` | Keep the tag button active while disabled |
| `showDeleteButtonWhenDisabled` | `boolean` | `false` | Keep the delete button visible while disabled |
| `remoteUploadConfig` | `AngularRemoteUploadConfig \| null` | `null` | Enables upload-from-phone via QR pairing |

### 📡 Outputs

| Output | Emits | Description |
|---|---|---|
| `onFileSelect` | `any` | A file was chosen, before upload starts |
| `uploadInProgress` | — | Upload started |
| `onUploaded` | — | Upload finished |
| `onFileRemoved` | `any` | A file was removed |
| `onError` | — | Upload or validation failed |
| `onRemoteUpload` | `AngularRemoteUploadEvent` | Progress of a phone-paired remote upload |
| `dataSequenceChange` | `any` | Preview order changed via drag and drop |

---

## 📤 Example Usage

### HTML

```html
<angular-image-and-file-picker
  [urlConfig]="urlConfig"
  [entityType]="'announcement_details'"
  [disabled]="false"
  viewType="card"
  [options]="{
    selectorId: 'choosing-image-for-announcement-details',
    height: '108px',
    isStoredDb: false,
    isMultiple: true,
    cols: 5,
    isCompressed: false
  }"
  accept=".png,.jpeg,.jpg"
  label="Upload Image"
  [data]="files"
  [dialogConfig]="getImagePickerDialogConfig()">
</angular-image-and-file-picker>
```

### Component (TS)

```ts
urlConfig: UrlConfig = {
  getUploadUrl: 'https://your-api/get-upload-url',
  attachToEntity: 'https://your-api/attach-to-entity',
  removeImage: 'https://your-api/remove-url',
};

files = [
  {
    s3Url: 'https://bucket-url/file1.jpg',
    uploadData: {
      uploadURL: 'https://bucket-url/upload',
      fileName: 'example.jpg',
      uploadPath: '/entity/example.jpg',
      resourceUrl: 'https://bucket-url/example.jpg'
    }
  }
];

getImagePickerDialogConfig(): DialogConfig {
  return {
    title: 'Delete Image',
    message: 'Are you sure you want to delete this image?',
    iconClass: 'angular-text-danger',
    icon: 'delete',
    approveButtonText: 'Yes',
    approveButtonClass: 'angular-btn-danger',
    cancelButtonText: 'No',
    cancelButtonClass: 'angular-btn-primary'
  };
}
```

---

## 🖼️ File Types Supported

Component auto-detects and handles:

- 📄 PDF
- 📷 Images (`jpg`, `jpeg`, `png`)
- 📹 Videos
- 📊 Excel & CSV
- 📦 Raw files (opens via download or fallback preview)

---

## 🔌 Standalone App Integration

In `main.ts`:

```ts
import { provideHttpClient } from '@angular/common/http';

bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient()
  ]
});
```

---

## 🎨 Styling

The component uses Angular Material — ensure a theme is included:

```json
"styles": [
  "@angular/material/prebuilt-themes/azure-blue.css",
  "src/styles.scss"
]
```

---



## 📡 API Contract for Upload Integration

The component requires a pre-signed URL from your backend to upload files directly to cloud storage (like AWS S3). You must implement an API endpoint that responds with the following JSON structure:

### ✅ Sample Response from `getUploadUrl`

```json
{
  "data": {
    "uploadUrlData": {
      "uploadURL": "https://your-s3-bucket/your-object-key.jpg?...",
      "fileName": "your-object-key.jpg",
      "uploadPath": "/folder/your-object-key.jpg",
      "resourceUrl": "https://your-s3-bucket/your-object-key.jpg"
    }
  },
  "message": "Upload Url generated successfully!"
}
```

- **uploadURL**: This is the pre-signed `PUT` URL. The component will upload the file directly to this URL.
- **fileName**: Name of the file being uploaded.
- **uploadPath**: Optional path metadata for organizing resources.
- **resourceUrl**: The final public/accessible URL for accessing the uploaded file.

---

## 📤 How Upload Works Internally

When a user selects a file:

1. The component calls your `getUploadUrl` API with basic metadata (like file name/type).
2. Your backend returns a `PUT` pre-signed URL via `uploadURL`.
3. The component performs a **`PUT` request directly to that URL**, sending the image or file binary.
4. After success, the `resourceUrl` is used for rendering or viewing.

---

## 🔌 Backend API Example (Node.js)

Here’s a basic AWS S3 backend implementation in Node.js:

```js
const AWS = require('aws-sdk');
const s3 = new AWS.S3();

app.post('/api/get-upload-url', (req, res) => {
  const fileName = req.body.fileName;
  const fileType = req.body.fileType;
  const key = `cm_cases/${uuidv4()}.${fileType.split('/')[1]}`;

  const params = {
    Bucket: 'your-s3-bucket',
    Key: key,
    ContentType: fileType,
    ACL: 'public-read',
    Expires: 900,
  };

  const uploadURL = s3.getSignedUrl('putObject', params);
  res.json({
    data: {
      uploadUrlData: {
        uploadURL,
        fileName,
        uploadPath: `/${key}`,
        resourceUrl: `https://your-s3-bucket.s3.amazonaws.com/${key}`
      }
    },
    message: "Upload Url generated successfully!"
  });
});
```

---


## 🤝 Contributing

1. Clone the repo
2. Run `npm install`
3. Use the demo app to test (`projects/` directory)
4. Submit a PR or issue with details

---

## 🚀 Publishing to npm

```bash
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions will build and publish to npm automatically if configured.

---

## 📬 Support / Questions

For bugs, suggestions, or feature requests, please open an issue on the [GitHub repository](https://github.com/Thai-Informatics-System/angular-image-and-file-picker).

---

> Made with ❤️ by [Thai Informatic Systems Co. Ltd](https://tis.co.th/)

