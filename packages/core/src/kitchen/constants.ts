/** Status of a kitchen ticket sent to a station (RF-C20…RF-C22). */
export const KITCHEN_TICKET_STATUSES = ['sent', 'preparing', 'ready', 'served', 'voided'] as const;
export type KitchenTicketStatus = (typeof KITCHEN_TICKET_STATUSES)[number];

/**
 * Progress of an item at ONE station (DEC-029). An item routed to two stations is ready only
 * when both are; serving and voiding belong to the item, not to the station.
 */
export const KITCHEN_ITEM_STATUSES = ['sent', 'preparing', 'ready'] as const;
export type KitchenItemStatus = (typeof KITCHEN_ITEM_STATUSES)[number];
