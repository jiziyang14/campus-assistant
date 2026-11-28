import { request } from './client.js'

export type BalanceInfo = {
  currency: 'CNY' | 'USD'
  total_balance: string
  granted_balance: string
  topped_up_balance: string
}

export type UserBalance = {
  is_available?: boolean
  balance_infos?: BalanceInfo[]
}

/**
 * 查询账户余额：GET /user/balance。请求走同源代理，Key 由本地服务端注入，
 * 前端不接触真实密钥。
 */
export const fetchBalance = async (signal?: AbortSignal): Promise<UserBalance> => {
  const response = await request('/user/balance', {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  })
  return (await response.json()) as UserBalance
}

export const currencySymbol = (currency: string): string => (currency === 'USD' ? '$' : '¥')
