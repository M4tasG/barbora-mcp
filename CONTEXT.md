# Barbora shopping

An agent helps a shopper buy groceries on Barbora without the shopper copying session data out of the browser.

## Language

**Shopper**:
The person who owns the Barbora account and pays for the order.
_Avoid_: User, customer, account

**Shop**:
One Barbora country site: Lithuania, Estonia, or Latvia.
_Avoid_: Store, market

**Session**:
The cookie jar that proves a shopper is signed in to a shop. Both sign-in methods write the same session.
_Avoid_: Token, credential file, cookie dump

**Password sign-in**:
The shopper types their email and password into a masked prompt. The tool posts them to the shop and keeps only the session.
_Avoid_: API login, credential login

**Browser sign-in**:
A browser window on the shop's own login page. The shopper signs in there, including with Google, Facebook, or Apple. The tool saves the session when the shop accepts them.
_Avoid_: Cookie rip, devtools export, OAuth hack

**Catalog**:
The products a shop is selling right now, with prices for the shopper's shop code.
_Avoid_: Index, inventory dump

**Product**:
One sellable line in the catalog, with an id, a title, a price, and a unit.
_Avoid_: SKU, item, article

**Cart**:
The shopper's current basket on the shop, priced by the shop.
_Avoid_: Basket, bag

**Slot**:
The delivery window the shopper reserves before the shop will accept an order.
_Avoid_: Timeslot, window, booking

**Checkout**:
The step where the shopper reviews address, slot, and total, then pays.
_Avoid_: Submit, purchase

**Confirm**:
The shopper's explicit yes to the cart lines, one stated total, one address, and one slot. A vague "buy the usual" is not a confirm.
_Avoid_: Approval, consent flag
