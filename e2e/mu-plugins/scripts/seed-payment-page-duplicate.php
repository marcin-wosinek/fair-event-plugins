<?php
/**
 * Seed a published page carrying two simple-payment blocks that share the
 * same blockId (as if the editor's duplicate-detection had never run, e.g. a
 * pre-fix page nobody has reopened), for the E2E spec covering the
 * endpoint's ambiguous-block hardening.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-payment-page-duplicate.php [amount1] [amount2]
 *
 * Prints a single `E2E_PAYMENT_PAGE_DUPLICATE:{json}` line with the page id,
 * permalink, the shared block id, and each copy's own amount.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

$amount_1 = isset( $args[0] ) && '' !== $args[0] ? (string) (float) $args[0] : '12.50';
$amount_2 = isset( $args[1] ) && '' !== $args[1] ? (string) (float) $args[1] : '45.00';

$block_id = wp_generate_uuid4();

$block_content = '<!-- wp:fair-payment/simple-payment ' . wp_json_encode(
	array(
		'blockId'     => $block_id,
		'amount'      => $amount_1,
		'description' => 'E2E duplicate payment block 1',
	)
) . ' /-->' . "\n" . '<!-- wp:fair-payment/simple-payment ' . wp_json_encode(
	array(
		'blockId'     => $block_id,
		'amount'      => $amount_2,
		'description' => 'E2E duplicate payment block 2',
	)
) . ' /-->';

$page_id = wp_insert_post(
	array(
		'post_type'    => 'page',
		'post_status'  => 'publish',
		'post_title'   => 'E2E Duplicate Simple Payment ' . gmdate( 'YmdHis' ) . ' ' . wp_rand( 1000, 9999 ),
		'post_content' => $block_content,
	),
	true
);

if ( is_wp_error( $page_id ) ) {
	WP_CLI::error( 'Failed to create duplicate payment page: ' . $page_id->get_error_message() );
}

echo 'E2E_PAYMENT_PAGE_DUPLICATE:' . wp_json_encode(
	array(
		'pageId'  => (int) $page_id,
		'pageUrl' => get_permalink( $page_id ),
		'blockId' => $block_id,
		'amounts' => array( (float) $amount_1, (float) $amount_2 ),
	)
) . "\n";
