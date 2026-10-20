<?php
/**
 * Seed a published page carrying a saved Fair Form with a required short
 * text question, an email question and a file upload question, for the Fair
 * Form translations E2E spec (#1872).
 *
 * The blocks are stored under their original fair-audience/fair-form* names,
 * like every form saved before Fair Form got its own text domain, so the
 * spec can reopen and submit an existing form.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-fair-form-translations-page.php <formId>
 *
 * Prints a single `E2E_FAIR_FORM_TRANSLATIONS_PAGE:{json}` line with the
 * page id, permalink and form id.
 *
 * Tear down with `questionnaire-upload-state.php <formId> cleanup` for the
 * submission and `wp post delete <pageId> --force` for the page.
 *
 * @package FairFormE2E
 */

defined( 'ABSPATH' ) || exit;

$form_id = isset( $args[0] ) && '' !== $args[0] ? sanitize_key( $args[0] ) : 'e2e-translations';

$content = implode(
	'',
	array(
		'<!-- wp:fair-audience/fair-form ' . wp_json_encode(
			array(
				'formId'    => $form_id,
				'formTitle' => 'E2E Translations Form',
			)
		) . ' -->',
		'<!-- wp:fair-audience/fair-form-short-text ' . wp_json_encode(
			array(
				'questionKey'  => 'full_name',
				'questionText' => 'Your name',
				'required'     => true,
			)
		) . ' /-->',
		'<!-- wp:fair-audience/fair-form-email ' . wp_json_encode(
			array(
				'questionKey'  => 'email',
				'questionText' => 'Your email',
			)
		) . ' /-->',
		'<!-- wp:fair-audience/fair-form-file-upload ' . wp_json_encode(
			array(
				'questionKey'  => 'photo',
				'questionText' => 'Your photo',
			)
		) . ' /-->',
		'<!-- /wp:fair-audience/fair-form -->',
	)
);

$page_id = wp_insert_post(
	array(
		'post_type'    => 'page',
		'post_status'  => 'publish',
		'post_title'   => 'E2E Fair Form Translations ' . gmdate( 'YmdHis' ) . ' ' . wp_rand( 1000, 9999 ),
		'post_content' => $content,
	),
	true
);

if ( is_wp_error( $page_id ) ) {
	WP_CLI::error( 'Failed to create page: ' . $page_id->get_error_message() );
}

echo 'E2E_FAIR_FORM_TRANSLATIONS_PAGE:' . wp_json_encode(
	array(
		'pageId'  => (int) $page_id,
		'pageUrl' => get_permalink( $page_id ),
		'formId'  => $form_id,
	)
) . "\n";
