---
name: barbora
description: >
  Shop on Barbora for a shopper. Use when signing in to barbora.lt, barbora.ee,
  or barbora.lv, searching the catalog, changing the cart, previewing checkout,
  reserving a delivery slot, or placing an order after the shopper confirms one total, address, and slot.
---

# Shop on Barbora

Use the local `barbora` MCP tools. The shopper owns the account and pays. Pass the shop the shopper named. When they name none, pass LT.

## Sign in

Call `session_status`.

When the shopper is signed out, ask which sign-in to use.

- `password_sign_in` sends the email and password on that call. The password exists only as the argument of that call.
- `browser_sign_in` opens the shop login page. Google, Facebook, and Apple work there.

Done when `session_status` names the shop.

## Read the cart

Call `cart_read` after sign-in, before choosing products.

Done when you know the current lines and the shop total.

## Find a product

`search` for the shopper's words. Skip a title that starts with `UAT`.

`product` reads one slug when the shopper asks about that product.

Done when each product you will add has an id, a price, and a unit.

## Change the cart

`cart_add` takes the product id and the quantity. Pass `min`, `max`, and `step` together when you know the unit.

`cart_update` changes a quantity. `cart_remove` takes a product off the cart. `cart_clear` removes every line. An empty cart stays empty.

Done when the cart the tool returns is the cart the shopper asked for.

## Preview

Call `checkout_preview`. Show the shopper the lines, the address, the slot, and the total.

Stop before `place_order` while the address is unchosen, the slot is unchosen, a line is age-restricted, or the age check is still open. The preview marks an age-restricted line as age-limited. Tell the shopper which of those is open.

When the slot is unchosen, call `list_slots` and show the open hours. Call `reserve_slot` only after the shopper names one day and one hour. Then call `checkout_preview` again. Delivery can change the total.

Done when you have shown the shopper that preview.

## Confirm

A confirm is the shopper's yes to one total, one address, and one slot on the latest checkout preview.

"Buy the usual" is not a confirm. Ask for the total, the address, and the slot.

Done when the shopper has named those three, and they match the latest preview.

## Place the order

Call `place_order` with that total, address, and slot.

When the confirm does not match, call `checkout_preview` again and ask the shopper to confirm the new checkout.

When the tool returns a payment URL, give that URL to the shopper and stop. The shopper finishes the bank or card step.

When the tool says the shop accepted the order, tell the shopper and include the order id.

Done when the shopper has the payment URL, or you have reported the order id.
