// The File System Access API (Chrome, Edge) isn't in TypeScript's DOM types yet.
interface FilePickerOptions {
  types?: { description?: string; accept: Record<string, string[]> }[];
  suggestedName?: string;
}
interface Window {
  showOpenFilePicker(options?: FilePickerOptions): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker(options?: FilePickerOptions): Promise<FileSystemFileHandle>;
}
interface FileSystemHandle {
  queryPermission(descriptor?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission(descriptor?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
}
