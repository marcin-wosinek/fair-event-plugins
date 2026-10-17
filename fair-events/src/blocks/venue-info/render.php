<?php
/**
 * Venue Info Block - Server-side rendering
 *
 * @package FairEvents
 *
 * @var array    $attributes Block attributes.
 * @var string   $content    Block default content.
 * @var WP_Block $block      Block instance.
 */

defined( 'WPINC' ) || die;

$venue_info_html = \FairEvents\Services\VenueInfoRenderer::render(
	$attributes['venueId'] ?? 0,
	get_block_wrapper_attributes()
);

echo $venue_info_html; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- fully escaped inside the renderer.
