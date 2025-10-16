<?php
/**
 * Server-side rendering for Show Until block
 *
 * @package FairScheduleBlocks
 */

defined( 'WPINC' ) || die;

// Get block attributes and context
$hide_after = $attributes['hideAfter'] ?? '';
$post_id    = $block->context['postId'] ?? get_the_ID();

// Resolve event-specific dates if fair-events plugin is active
if ( ! empty( $hide_after ) && function_exists( 'fair_events_resolve_date' ) ) {
	$hide_after = fair_events_resolve_date( $hide_after, $post_id );
}

// If no date is set or the current time is after the hide date, don't render
if ( ! empty( $hide_after ) ) {
	try {
		// Parse ISO string and convert to site timezone
		$hide_time = new DateTime( $hide_after );
		$hide_time->setTimezone( wp_timezone() );
		$current_time = current_datetime();

		// If current time is after hide time, don't render
		if ( $current_time >= $hide_time ) {
			return '';
		}
	} catch ( Exception $e ) {
		// If date parsing fails, render the content
	}
}

// Get wrapper attributes
$wrapper_attributes = get_block_wrapper_attributes(
	array(
		'class'           => 'show-until-container',
		'data-hide-after' => esc_attr( $hide_after ),
	)
);
?>

<div <?php echo wp_kses_data( $wrapper_attributes ); ?>>
	<?php echo wp_kses_post( $content ); ?>
</div>
