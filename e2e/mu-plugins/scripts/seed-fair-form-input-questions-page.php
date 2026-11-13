<?php
/**
 * Seed a published page carrying a Fair Form block with one of each
 * single-input question sharing the editor and renderer of #2235: Date,
 * Date & Time, Email and Short Text, all required.
 *
 * Pass `legacy` to save the blocks under their pre-#1161
 * `fair-audience/fair-form*` names instead, the way old imports and restored
 * revisions bring them back.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-fair-form-input-questions-page.php [legacy]
 *
 * Prints a single `E2E_FAIR_FORM_INPUT_QUESTIONS_PAGE:{json}` line with the
 * page id, permalink and the seeded question definitions.
 *
 * Tear down with cleanup-fair-form-notification-page.php <pageId> (generic:
 * page id -> submissions/answers).
 *
 * @package FairFormE2E
 */

defined( 'ABSPATH' ) || exit;

$namespace = isset( $args[0] ) && 'legacy' === $args[0] ? 'fair-audience' : 'fair-form';

$questions = array(
	array(
		'slug'         => 'fair-form-date',
		'questionKey'  => 'visit_date',
		'questionText' => 'Visit date',
	),
	array(
		'slug'         => 'fair-form-datetime',
		'questionKey'  => 'arrival',
		'questionText' => 'Arrival time',
	),
	array(
		'slug'         => 'fair-form-email',
		'questionKey'  => 'email',
		'questionText' => 'Your email',
		'placeholder'  => 'name@example.com',
	),
	array(
		'slug'         => 'fair-form-short-text',
		'questionKey'  => 'full_name',
		'questionText' => 'Your name',
	),
);

$blocks = array();
foreach ( $questions as $question ) {
	$attributes = array_merge(
		array_diff_key( $question, array( 'slug' => true ) ),
		array( 'required' => true )
	);
	$blocks[]   = '<!-- wp:' . $namespace . '/' . $question['slug'] . ' ' . wp_json_encode( $attributes ) . ' /-->';
}

$content = '<!-- wp:' . $namespace . '/fair-form -->'
	. implode( '', $blocks )
	. '<!-- /wp:' . $namespace . '/fair-form -->';

$page_id = wp_insert_post(
	array(
		'post_type'    => 'page',
		'post_status'  => 'publish',
		'post_title'   => 'E2E Fair Form Input Questions ' . gmdate( 'YmdHis' ) . ' ' . wp_rand( 1000, 9999 ),
		'post_content' => $content,
	),
	true
);

if ( is_wp_error( $page_id ) ) {
	WP_CLI::error( 'Failed to create page: ' . $page_id->get_error_message() );
}

echo 'E2E_FAIR_FORM_INPUT_QUESTIONS_PAGE:' . wp_json_encode(
	array(
		'pageId'    => (int) $page_id,
		'pageUrl'   => get_permalink( $page_id ),
		'questions' => $questions,
	)
) . "\n";
