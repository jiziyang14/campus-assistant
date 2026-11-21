/** 摄像头枚举与切换：桌面浏览器不识别 facingMode，切换摄像头必须按 deviceId 精确选择 */
export type CameraOption = {
  deviceId: string
  label: string
}

/** 从 enumerateDevices 结果中取出摄像头：过滤非视频设备、空 deviceId 和重复项 */
export const collectCameras = (devices: MediaDeviceInfo[]): CameraOption[] => {
  const seen = new Set<string>()
  const cameras: CameraOption[] = []
  for (const device of devices) {
    if (device.kind !== 'videoinput') {
      continue
    }
    if (!device.deviceId || seen.has(device.deviceId)) {
      continue
    }
    seen.add(device.deviceId)
    cameras.push({ deviceId: device.deviceId, label: device.label })
  }
  return cameras
}

/** 轮转到下一台摄像头；当前设备未知时从第一台开始 */
export const nextCamera = (
  cameras: CameraOption[],
  currentDeviceId: string | null
): CameraOption | null => {
  if (cameras.length === 0) {
    return null
  }
  const current = cameras.findIndex((camera) => camera.deviceId === currentDeviceId)
  const next = current < 0 ? 0 : (current + 1) % cameras.length
  return cameras[next]
}

/**
 * 展台（实物展台/高拍仪）常见的设备名特征：希沃展台在 Windows 上显示为 “SC06 (1ff7:0f51)”，
 * 鸿合展台为 “HiteVision Visualizer”，其他品牌多用“展台/实物/高拍/visualizer/document camera”。
 * 拍照默认优先使用展台摄像头，拍作业、试卷时正对桌面。
 */
const DOCUMENT_CAMERA_PATTERN =
  /(展台|实物|高拍|视频展|visuali[sz]|document\s*cam|doc\s*cam|overhead|\bsc\d{2,4}\b)/i

/** 从摄像头列表里找展台摄像头；没有则返回 null，交给系统默认摄像头 */
export const findDocumentCamera = (cameras: CameraOption[]): CameraOption | null =>
  cameras.find((camera) => DOCUMENT_CAMERA_PATTERN.test(camera.label)) ?? null
