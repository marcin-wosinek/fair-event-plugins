<?php
/**
 * Render callback for the Fair Form Email question block
 *
 * @package FairForm
 * @param array    $attributes Block attributes.
 * @param string   $content    Block content.
 * @param WP_Block $block      Block instance.
 * @return string Rendered block HTML.
 */

defined( 'WPINC' ) || die;

// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- The renderer escapes its markup.
echo \FairForm\Services\InputQuestionRenderer::render( $attributes, 'email', 'email', 'fair-form-question-email' );
