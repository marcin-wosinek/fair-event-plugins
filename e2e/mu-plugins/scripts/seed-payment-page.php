<?php
/**
 * Seed a published page carrying the simple-payment block for the E2E specs.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-payment-page.php [amount] [description]
 *
 * Prints a single `E2E_PAYMENT_PAGE:{json}` line with the page id + permalink.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

$amount      = isset( $args[0] ) && '' !== $args[0] ? (string) (float) $args[0] : '12.50';
$description = isset( $args[1] ) && '' !== $args[1] ? (string) $args[1] : 'E2E simple payment';

// The editor assigns every simple-payment block a UUID blockId attribute;
// the payment endpoint derives the authoritative amount by matching it, so
// the seeded block must carry one too.
$block_attrs = wp_json_encode(
	array(
		'blockId'     => wp_generate_uuid4(),
		'amount'      => $amount,
		'description' => $description,
	)
);

$page_id = wp_insert_post(
	array(
		'post_type'    => 'page',
		'post_status'  => 'publish',
		'post_title'   => 'E2E Simple Payment ' . gmdate( 'YmdHis' ) . ' ' . wp_rand( 1000, 9999 ),
		'post_content' => '<!-- wp:fair-payment/simple-payment ' . $block_attrs . ' /-->',
	),
	true
);

if ( is_wp_error( $page_id ) ) {
	WP_CLI::error( 'Failed to create payment page: ' . $page_id->get_error_message() );
}

echo 'E2E_PAYMENT_PAGE:' . wp_json_encode(
	array(
		'pageId'      => (int) $page_id,
		'pageUrl'     => get_permalink( $page_id ),
		'amount'      => (float) $amount,
		'description' => $description,
	)
) . "\n";
