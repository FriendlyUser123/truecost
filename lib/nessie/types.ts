/** Wire shapes from api.nessieisreal.com, narrowed to the fields we read. */

export interface NessieAccount {
  _id: string;
  type: 'Checking' | 'Savings' | 'Credit Card';
  nickname: string;
  rewards: number;
  balance: number; // DOLLARS on the wire
  account_number?: string;
  customer_id: string;
}

export interface NessieAddress {
  street_number: string;
  street_name: string;
  city: string;
  state: string;
  zip: string;
}

export interface NessieGeocode {
  lat: number;
  lng: number;
}

export interface NessieMerchant {
  _id: string;
  name: string;
  category: string[];
  address?: NessieAddress;
  /**
   * Optional because the fixture merchants predate the ATM work and carry no
   * coordinates. Only the pharmacy merchants the seed script creates need one:
   * the ATM radius query is centred on the pharmacy the patient would walk to.
   */
  geocode?: NessieGeocode;
}

/**
 * `GET /atms?lat=&lng=&rad=`.
 *
 * `amount_left` is DOLLARS on the wire, like every other Nessie amount. It is
 * the cash the machine still holds; an ATM that cannot dispense the copay is
 * not an answer to "where do I get the money", so getAtmsNear filters on it.
 *
 * `accessibility` is Nessie's own wheelchair-access flag. We do not soften it
 * into a preference — a patient who needs it and does not get it has not been
 * given a cash point at all.
 */
export interface NessieAtm {
  _id: string;
  name: string;
  language_list: string[];
  address: NessieAddress;
  geocode: NessieGeocode;
  amount_left: number; // DOLLARS on the wire
  accessibility: boolean;
  hours: string[];
  /**
   * NOT on the wire. Great-circle miles from the query centre, computed by
   * getAtmsNear so the card can print "1.2 mi" without re-deriving it.
   */
  distanceMiles?: number;
}

export interface NessieDeposit {
  _id: string;
  type: 'deposit';
  transaction_date: string;
  status: string;
  payee_id: string;
  medium: 'balance';
  amount: number;
  description: string;
}

export interface NessieWithdrawal {
  _id: string;
  type: 'withdrawal';
  transaction_date: string;
  status: string;
  payer_id: string;
  medium: 'balance';
  amount: number;
  description: string;
}

export interface NessiePurchase {
  _id: string;
  merchant_id: string;
  payer_id: string;
  purchase_date: string;
  amount: number;
  status: string;
  medium: 'balance';
  description: string;
}

export interface NessieBill {
  _id: string;
  status: 'pending' | 'recurring' | 'cancelled' | 'completed';
  payee: string;
  nickname: string;
  creation_date: string;
  payment_date?: string;
  recurring_date: number;
  upcoming_payment_date: string;
  payment_amount: number;
  account_id: string;
}

export interface NessieTransfer {
  _id: string;
  type: 'transfer';
  transaction_date: string;
  status: string;
  medium: 'balance';
  payer_id: string;
  payee_id: string;
  amount: number;
  description: string;
}

export interface LedgerSnapshot {
  customerId: string;
  checking: NessieAccount;
  savings: NessieAccount;
  merchants: NessieMerchant[];
  deposits: NessieDeposit[];
  withdrawals: NessieWithdrawal[];
  purchases: NessiePurchase[];
  transfers: NessieTransfer[];
  bills: NessieBill[];
}
