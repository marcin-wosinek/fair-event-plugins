<?php
/**
 * Server-side rendering for Calendar Button block
 *
 * @package FairCalendarButton
 */

defined( 'WPINC' ) || die;

echo \FairCalendarButton\Render\CalendarButtonRenderer::render( $attributes, $content, $block ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Escaped by the renderer.
