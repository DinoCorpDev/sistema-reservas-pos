/** Estado de un ticket de cocina enviado a una estación (RF-C20…RF-C22). */
export const KITCHEN_TICKET_STATUSES = ['sent', 'preparing', 'ready', 'served', 'voided'] as const;
export type KitchenTicketStatus = (typeof KITCHEN_TICKET_STATUSES)[number];
