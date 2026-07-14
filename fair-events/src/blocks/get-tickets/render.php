<?php
/**
 * Get Tickets Block - Server-side rendering (legacy alias)
 *
 * Superseded by fair-events/event-signup. Existing content is rendered by
 * delegating to the unified block, which owns the base form and (when
 * fair-audience is active) the participant-aware flow. Kept so old posts keep
 * working; hidden from the inserter via block.json.
 *
 * @package FairEvents
 *
 * @var array    $attributes Block attributes.
 * @var string   $content    Block default content.
 * @var WP_Block $block      Block instance.
 */

defined( 'WPINC' ) || die;

echo render_block( // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- render_block() returns trusted, already-escaped block markup.
	array(
		'blockName' => 'fair-events/event-signup',
		'attrs'     => array(
			'eventDateId'      => (int) ( $attributes['eventDateId'] ?? 0 ),
			'submitButtonText' => $attributes['submitButtonText'] ?? '',
		),
	)
);
