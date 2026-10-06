'use server';

import { admin } from '@pos/api';
import { createTaxRateSchema, createTaxRuleSchema, updateTaxCategorySchema } from '@pos/core';
import { revalidatePath } from 'next/cache';
import { runAction } from '@/server/action';
import { currentActor, deps } from '@/server/actor';

// The setup checklist (overview) checks the MWST rules too.
const done = <T>(value: T) => {
  revalidatePath('/backoffice/tax');
  revalidatePath('/backoffice');
  return value;
};

export async function renameTaxCategory(id: string, input: unknown) {
  return runAction(async () =>
    done(
      await admin.renameTaxCategory(
        deps(),
        await currentActor(),
        id,
        updateTaxCategorySchema.parse(input),
      ),
    ),
  );
}

export async function createTaxRate(input: unknown) {
  return runAction(async () =>
    done(await admin.createTaxRate(deps(), await currentActor(), createTaxRateSchema.parse(input))),
  );
}

export async function createTaxRule(input: unknown) {
  return runAction(async () =>
    done(await admin.createTaxRule(deps(), await currentActor(), createTaxRuleSchema.parse(input))),
  );
}
