export async function requestJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error(response.ok ? 'The server returned an unexpected response.' : 'The school service is unavailable. Check its configuration and try again.')
  }
  const result = await response.json() as T & { message?: string }
  if (!response.ok) throw new Error(result.message ?? 'The request could not be completed.')
  return result
}

export async function requestNoContent(path: string, options?: RequestInit): Promise<void> {
  const response = await fetch(path, {
    credentials: 'include',
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
  if (!response.ok) {
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new Error('The school service is unavailable. Check its configuration and try again.')
    }
    const result = await response.json() as { message?: string }
    throw new Error(result.message ?? 'The request could not be completed.')
  }
}
