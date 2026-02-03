<?php
require_once 'vendor/autoload.php';

$dotenv = Dotenv\Dotenv::createImmutable(__DIR__);
$dotenv->load();

$stripeSecretKey = $_ENV['STRIPE_SECRET_KEY'];

// Instagram/Facebook App credentials for Instagram Graph API.
$instagramAppId     = $_ENV['INSTAGRAM_APP_ID'] ?? '';
$instagramAppSecret = $_ENV['INSTAGRAM_APP_SECRET'] ?? '';
?>
