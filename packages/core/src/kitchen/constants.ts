/** Status of a kitchen ticket sent to a station (RF-C20…RF-C22). */
export const KITCHEN_TICKET_STATUSES = ['sent', 'preparing', 'ready', 'served', 'voided'] as const;
export type KitchenTicketStatus = (typeof KITCHEN_TICKET_STATUSES)[number];
