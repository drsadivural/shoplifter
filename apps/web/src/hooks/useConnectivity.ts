import { useEffect, useState } from 'react';
import { connectivity, type ConnectivitySnapshot } from '../api/connectivity';

/** Live view of the API connectivity tracker (last successful sync, last failed request). */
export function useConnectivity(): ConnectivitySnapshot {
  const [snap, setSnap] = useState(() => connectivity.snapshot());
  useEffect(() => {
    setSnap(connectivity.snapshot());
    return connectivity.subscribe(setSnap);
  }, []);
  return snap;
}
