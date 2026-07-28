<?php
/**
 * Seed a published page carrying a Fair Form block with real question blocks
 * for the submission-detail E2E suite (#619).
 *
 * Unlike seed-fair-form-notification-page.php — which deliberately carries no
 * inner blocks, because that suite posts answers straight to REST — this seed
 * needs the questions to actually render, so the spec can fill and submit the
 * form through the browser and exercise the full
 * frontend submit -> storage -> admin detail view path.
 *
 * Covers the three question shapes the detail page renders differently:
 * short text, email (which also drives participant auto-creation), and a
 * single-choice select built from inner option blocks.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-fair-form-questions-page.php [formId] [formTitle]
 *
 * Prints a single `E2E_FAIR_FORM_QUESTIONS_PAGE:{json}` line with the page id,
 * permalink, form id/title and the seeded question definitions.
 *
 * Tear down with `cleanup-fair-form-notification-page.php <pageId>`, which is
 * generic (page id -> submissions/answers) and serves both fair-form seeds.
 *
 * @package FairFormE2E
 */

defined( 'ABSPATH' ) || exit;

$form_id    = isset( $args[0] ) && '' !== $args[0] ? (string) $args[0] : 'e2e-detail';
$form_title = isset( $args[1] ) && '' !== $args[1] ? (string) $args[1] : 'E2E Detail Form';

$questions = array(
	'full_name' => 'Your name',
	'email'     => 'Your email',
	'how_heard' => 'How did you hear about us?',
);

$choices = array( 'A friend', 'Social media' );

$option_blocks = '';
foreach ( $choices as $choice ) {
	$option_blocks .= '<!-- wp:fair-audience/fair-form-option ' . wp_json_encode( array( 'value' => $choice ) ) . ' /-->';
}

$content = implode(
	'',
	array(
		'<!-- wp:fair-audience/fair-form ' . wp_json_encode(
			array(
				'formId'    => $form_id,
				'formTitle' => $form_title,
			)
		) . ' -->',
		'<!-- wp:fair-audience/fair-form-short-text ' . wp_json_encode(
			array(
				'questionKey'  => 'full_name',
				'questionText' => $questions['full_name'],
			)
		) . ' /-->',
		'<!-- wp:fair-audience/fair-form-email ' . wp_json_encode(
			array(
				'questionKey'  => 'email',
				'questionText' => $questions['email'],
			)
		) . ' /-->',
		'<!-- wp:fair-audience/fair-form-select-one ' . wp_json_encode(
			array(
				'questionKey'  => 'how_heard',
				'questionText' => $questions['how_heard'],
			)
		) . ' -->',
		$option_blocks,
		'<!-- /wp:fair-audience/fair-form-select-one -->',
		'<!-- /wp:fair-audience/fair-form -->',
	)
);

$page_id = wp_insert_post(
	array(
		'post_type'    => 'page',
		'post_status'  => 'publish',
		'post_title'   => 'E2E Fair Form Questions ' . gmdate( 'YmdHis' ) . ' ' . wp_rand( 1000, 9999 ),
		'post_content' => $content,
	),
	true
);

if ( is_wp_error( $page_id ) ) {
	WP_CLI::error( 'Failed to create page: ' . $page_id->get_error_message() );
}

echo 'E2E_FAIR_FORM_QUESTIONS_PAGE:' . wp_json_encode(
	array(
		'pageId'    => (int) $page_id,
		'pageUrl'   => get_permalink( $page_id ),
		'formId'    => $form_id,
		'formTitle' => $form_title,
		'questions' => $questions,
		'choices'   => $choices,
	)
) . "\n";
