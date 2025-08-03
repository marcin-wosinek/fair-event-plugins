<?php

require_once './vendor/autoload.php';
require_once './secrets.php';

header('Content-Type: application/json');

$stripe = new \Stripe\StripeClient([
  // This is your test secret API key.
  "api_key" => $stripeSecretKey,
]);

try {
  $account = $stripe->accounts->create();

  echo json_encode(array(
    'account' => $account->id
  ));
} catch (Exception $e) {
  error_log("An error occurred when calling the Stripe API to create an account: {$e->getMessage()}");
  http_response_code(500);
  echo json_encode(['error' => $e->getMessage()]);
}

?>
