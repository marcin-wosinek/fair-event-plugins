<?php
/**
 * Seed a published page carrying two simple-payment blocks with distinct
 * identifiers and different prices, for the E2E specs covering multiple
 * Simple Payment blocks coexisting on one page.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-payment-page-multi.php [amount1] [amount2]
 *
 * Prints a single `E2E_PAYMENT_PAGE_MULTI:{json}` line with the page id,
 * permalink, and each block's own id + amount.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

$amount_1 = isset( $args[0] ) && '' !== $args[0] ? (string) (float) $args[0] : '12.50';
$amount_2 = isset( $args[1] ) && '' !== $args[1] ? (string) (float) $args[1] : '45.00';

$block_id_1 = wp_generate_uuid4();
$block_id_2 = wp_generate_uuid4();

$block_content = '<!-- wp:fair-payment/simple-payment ' . wp_json_encode(
	array(
		'blockId'     => $block_id_1,
		'amount'      => $amount_1,
		'description' => 'E2E multi payment block 1',
	)
) . ' /-->' . "\n" . '<!-- wp:fair-payment/simple-payment ' . wp_json_encode(
	array(
		'blockId'     => $block_id_2,
		'amount'      => $amount_2,
		'description' => 'E2E multi payment block 2',
	)
) . ' /-->';

$page_id = wp_insert_post(
	array(
		'post_type'    => 'page',
		'post_status'  => 'publish',
		'post_title'   => 'E2E Multi Simple Payment ' . gmdate( 'YmdHis' ) . ' ' . wp_rand( 1000, 9999 ),
		'post_content' => $block_content,
	),
	true
);

if ( is_wp_error( $page_id ) ) {
	WP_CLI::error( 'Failed to create multi payment page: ' . $page_id->get_error_message() );
}

echo 'E2E_PAYMENT_PAGE_MULTI:' . wp_json_encode(
	array(
		'pageId'  => (int) $page_id,
		'pageUrl' => get_permalink( $page_id ),
		'blocks'  => array(
			array(
				'blockId' => $block_id_1,
				'amount'  => (float) $amount_1,
			),
			array(
				'blockId' => $block_id_2,
				'amount'  => (float) $amount_2,
			),
		),
	)
) . "\n";
