<?php
/**
 * Seed a published page carrying a Fair Form block with an email question
 * (for rate-limit/participant keying) and a URL question opted into "read
 * event details from the linked page" (#1327).
 *
 * Mirrors seed-fair-form-questions-page.php's shape (a real Fair Form block
 * the spec fills and submits through the browser), scoped to the one
 * question type this suite needs.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-fair-form-url-extraction-page.php
 *
 * Prints a single `E2E_FAIR_FORM_URL_EXTRACTION_PAGE:{json}` line with the
 * page id, permalink and the seeded question labels.
 *
 * Tear down with cleanup-fair-form-notification-page.php <pageId> (generic:
 * page id -> submissions/answers).
 *
 * @package FairFormE2E
 */

defined( 'ABSPATH' ) || exit;

$questions = array(
	'email'   => 'Your email',
	'website' => 'Event page',
);

$content = implode(
	'',
	array(
		'<!-- wp:fair-audience/fair-form -->',
		'<!-- wp:fair-audience/fair-form-email ' . wp_json_encode(
			array(
				'questionKey'  => 'email',
				'questionText' => $questions['email'],
			)
		) . ' /-->',
		'<!-- wp:fair-audience/fair-form-url ' . wp_json_encode(
			array(
				'questionKey'         => 'website',
				'questionText'        => $questions['website'],
				'extractEventDetails' => true,
			)
		) . ' /-->',
		'<!-- /wp:fair-audience/fair-form -->',
	)
);

$page_id = wp_insert_post(
	array(
		'post_type'    => 'page',
		'post_status'  => 'publish',
		'post_title'   => 'E2E Fair Form URL Extraction ' . gmdate( 'YmdHis' ) . ' ' . wp_rand( 1000, 9999 ),
		'post_content' => $content,
	),
	true
);

if ( is_wp_error( $page_id ) ) {
	WP_CLI::error( 'Failed to create page: ' . $page_id->get_error_message() );
}

echo 'E2E_FAIR_FORM_URL_EXTRACTION_PAGE:' . wp_json_encode(
	array(
		'pageId'    => (int) $page_id,
		'pageUrl'   => get_permalink( $page_id ),
		'questions' => $questions,
	)
) . "\n";
