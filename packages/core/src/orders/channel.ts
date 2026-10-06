import { DEFAULT_CONSUMPTION_BY_CHANNEL, type Channel, type ConsumptionType } from '../shared/channels';
import type { Rappen } from '../shared/money';
import {
  type IsoDate,
  priceLine,
  resolveTaxRate,
  type TaxRateRecord,
  type TaxRuleRecord,
} from '../tax/calculation';
import type { BasisPoints, TaxCategoryKey, TaxRateCode } from '../tax/constants';
import type { ItemPrepStatus, OrderPaymentStatus } from './constants';

export class OrderRuleError extends Error {
  override readonly name = 'OrderRuleError';
  constructor(
    readonly code: 'ORDER_ALREADY_PAID' | 'SAME_CHANNEL',
    message: string,
  ) {
    super(message);
  }
}

/** The tax-relevant part of an order line, as stored in `order_items`. */
export interface TaxedOrderLine {
  id: string;
  prepStatus: ItemPrepStatus;
  taxCategoryKey: TaxCategoryKey;
  unitPriceRappen: Rappen;
  modifiersRappen: Rappen;
  quantity: number;
  discountRappen: Rappen;
  lineTotalRappen: Rappen;
  taxRateCode: TaxRateCode;
  taxRateBp: BasisPoints;
  taxRappen: Rappen;
}

export interface ChannelChangeResult {
  channel: Channel;
  consumptionType: ConsumptionType;
  lines: TaxedOrderLine[];
  /** Audit payload for `order.channel_changed` (RN-05). */
  audit: {
    action: 'order.channel_changed';
    before: { channel: Channel; consumptionType: ConsumptionType; lines: LineTaxSnapshot[] };
    after: { channel: Channel; consumptionType: ConsumptionType; lines: LineTaxSnapshot[] };
  };
}

type LineTaxSnapshot = Pick<TaxedOrderLine, 'id' | 'taxRateCode' | 'taxRateBp' | 'taxRappen'>;

const snapshot = (line: TaxedOrderLine): LineTaxSnapshot => ({
  id: line.id,
  taxRateCode: line.taxRateCode,
  taxRateBp: line.taxRateBp,
  taxRappen: line.taxRappen,
});

/**
 * RN-05: an order that changes channel before it is paid (e.g. table → takeaway) gets the tax
 * rate of every line recalculated, and the change is audited. Once any payment exists it can no
 * longer change. Prices stay as sold; only rate and tax are recalculated. Voided lines keep their
 * frozen values (they are not part of the sale).
 */
export function changeOrderChannel(
  order: {
    channel: Channel;
    consumptionType: ConsumptionType;
    paymentStatus: OrderPaymentStatus;
    lines: readonly TaxedOrderLine[];
  },
  change: {
    channel: Channel;
    consumptionType?: ConsumptionType;
    saleDate: IsoDate;
    rules: readonly TaxRuleRecord[];
    rates: readonly TaxRateRecord[];
  },
): ChannelChangeResult {
  if (order.paymentStatus !== 'unpaid') {
    throw new OrderRuleError(
      'ORDER_ALREADY_PAID',
      `The channel of an order with payment status "${order.paymentStatus}" cannot change (RN-05)`,
    );
  }
  const consumptionType = change.consumptionType ?? DEFAULT_CONSUMPTION_BY_CHANNEL[change.channel];
  if (change.channel === order.channel && consumptionType === order.consumptionType) {
    throw new OrderRuleError('SAME_CHANNEL', 'The order already has this channel');
  }

  const lines = order.lines.map((line) => {
    if (line.prepStatus === 'voided') return line;
    const rate = resolveTaxRate({
      taxCategoryKey: line.taxCategoryKey,
      consumptionType,
      saleDate: change.saleDate,
      rules: change.rules,
      rates: change.rates,
    });
    const priced = priceLine({
      unitPriceRappen: line.unitPriceRappen,
      modifiersRappen: line.modifiersRappen,
      quantity: line.quantity,
      discountRappen: line.discountRappen,
      rate,
    });
    return {
      ...line,
      lineTotalRappen: priced.lineTotalRappen,
      taxRateCode: priced.taxRateCode,
      taxRateBp: priced.taxRateBp,
      taxRappen: priced.taxRappen,
    };
  });

  return {
    channel: change.channel,
    consumptionType,
    lines,
    audit: {
      action: 'order.channel_changed',
      before: {
        channel: order.channel,
        consumptionType: order.consumptionType,
        lines: order.lines.map(snapshot),
      },
      after: { channel: change.channel, consumptionType, lines: lines.map(snapshot) },
    },
  };
}
