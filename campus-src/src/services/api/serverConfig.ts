/**
 * 本地服务的 API Key 配置：公开分发的 exe 不嵌 Key，用户在设置里自行填写，
 * 由本地服务写入同目录 config.json；前端只读“是否已配置”，不回显密钥。
 */
export type ServerConfig = {
  configured: boolean
  apiBase?: string
  source?: string
}

export class ServerConfigError extends Error {}

const readError = async (response: Response): Promise<string> => {
  try {
    const data = (await response.json()) as { error?: { message?: string } }
    return data?.error?.message || `本地服务返回 ${response.status}`
  } catch {
    return `本地服务返回 ${response.status}`
  }
}

export const fetchServerConfig = async (signal?: AbortSignal): Promise<ServerConfig> => {
  const response = await fetch('/campus/api/config', { cache: 'no-store', signal })
  if (!response.ok) {
    throw new ServerConfigError(await readError(response))
  }
  return (await response.json()) as ServerConfig
}

export const saveServerApiKey = async (apiKey: string): Promise<void> => {
  const response = await fetch('/campus/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  })
  if (!response.ok) {
    throw new ServerConfigError(await readError(response))
  }
}
