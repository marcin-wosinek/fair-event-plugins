<?php

require_once './vendor/autoload.php';
require_once './secrets.php';

header('Content-Type: application/json');

$stripe = new \Stripe\StripeClient([
  // This is your test secret API key.
  "api_key" => $stripeSecretKey,
]);

try {
  $json = file_get_contents('php://input');
  $data = json_decode($json);
  $connectedAccountId = $data->account;

  $account_link = $stripe->accountLinks->create([
    'account' => $connectedAccountId,
    'return_url' => sprintf("http://localhost:4242/return/%s", $connectedAccountId),
    'refresh_url' => sprintf("http://localhost:4242/refresh/%s", $connectedAccountId),
    'type' => 'account_onboarding',
  ]);

  echo json_encode(array(
    'url' => $account_link->url
  ));
} catch (Exception $e) {
  error_log("An error occurred when calling the Stripe API to create an account link: {$e->getMessage()}");
  http_response_code(500);
  echo json_encode(['error' => $e->getMessage()]);
}

?>
