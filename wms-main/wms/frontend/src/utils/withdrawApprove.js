import {
  getWithdrawal,
  getInventory,
  saveWithdrawalPickRoute,
  updateWithdrawalStatus,
} from '../services/api';
import {
  getWithdrawPickDisplayItems,
  linesToPickRoutePayload,
} from './withdrawItemGrouping';

/** Same flow as Manage → Start Taking Out: apply pick route then advance to TAKING_OUT. */
export async function approveWithdrawalToTakingOut(requestId, managedBy) {
  const [wRes, invRes] = await Promise.all([
    getWithdrawal(requestId),
    getInventory({ merge_import_shipments: 1 }),
  ]);

  const data = wRes.data;
  if (data.status !== 'PENDING') {
    const err = new Error('Only pending requests can be approved');
    err.code = 'NOT_PENDING';
    throw err;
  }

  const inventory = invRes.data || [];
  const pickRouteTab = data.pick_route_saved ? (data.pick_route_mode || 'nearest') : 'nearest';
  const sortMode = pickRouteTab === 'fifo' ? 'cs_in_date' : 'nearest';
  const routeLines = getWithdrawPickDisplayItems(data, inventory, sortMode, {});

  await saveWithdrawalPickRoute(requestId, {
    mode: pickRouteTab,
    items: linesToPickRoutePayload(routeLines),
  });

  await updateWithdrawalStatus(requestId, {
    status: 'TAKING_OUT',
    managed_by: managedBy,
  });
}
