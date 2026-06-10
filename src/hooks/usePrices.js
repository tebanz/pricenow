import { useCallback, useState } from 'react'
import { supabase } from '../lib/supabase'

export function usePrices() {
  const [prices, setPrices] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchRanking = useCallback(async ({ productName = null, sector = null, limit = 30 } = {}) => {
    setLoading(true)
    setError(null)

    const { data, error: rpcError } = await supabase.rpc('get_price_ranking', {
      p_product_name: productName,
      p_sector: sector,
      p_limit: limit,
    })

    if (rpcError) {
      setError(rpcError.message)
      setPrices([])
    } else {
      setPrices(data ?? [])
    }

    setLoading(false)
    return { data, error: rpcError }
  }, [])

  return { prices, loading, error, fetchRanking }
}
