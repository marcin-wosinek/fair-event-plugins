<?php
/**
 * Event Dates Block - Server-side rendering
 *
 * @package FairEvents
 *
 * @var array    $attributes Block attributes.
 * @var string   $content    Block default content.
 * @var WP_Block $block      Block instance.
 */

defined( 'WPINC' ) || die;

// Get post ID from block context
$post_id = $block->context['postId'] ?? get_the_ID();

// Only render if we have a post ID
if ( ! $post_id ) {
	return '';
}

// Get event metadata
$event_start   = get_post_meta( $post_id, 'event_start', true );
$event_end     = get_post_meta( $post_id, 'event_end', true );
$event_all_day = get_post_meta( $post_id, 'event_all_day', true );

// Don't render if no event data
if ( ! $event_start && ! $event_end && ! $event_all_day ) {
	return '';
}

// Get WordPress date and time formats
$date_format = get_option( 'date_format' );
$time_format = get_option( 'time_format' );

/**
 * Format event datetime
 *
 * @param string $datetime Datetime string.
 * @param string $date_fmt Date format.
 * @param string $time_fmt Time format.
 * @return string Formatted datetime.
 */
if ( ! function_exists( 'fair_events_format_datetime' ) ) {
	function fair_events_format_datetime( $datetime, $date_fmt, $time_fmt ) {
		if ( empty( $datetime ) ) {
			return '';
		}

		$timestamp = strtotime( $datetime );
		if ( false === $timestamp ) {
			return $datetime;
		}

		return wp_date( $date_fmt . ' ' . $time_fmt, $timestamp );
	}
}
?>

<div <?php echo get_block_wrapper_attributes( array( 'class' => 'event-dates' ) ); ?>>
	<?php if ( $event_start ) : ?>
		<div class="event-date event-start">
			<strong><?php esc_html_e( 'Start:', 'fair-events' ); ?></strong>
			<?php echo esc_html( fair_events_format_datetime( $event_start, $date_format, $time_format ) ); ?>
		</div>
	<?php endif; ?>

	<?php if ( $event_end ) : ?>
		<div class="event-date event-end">
			<strong><?php esc_html_e( 'End:', 'fair-events' ); ?></strong>
			<?php echo esc_html( fair_events_format_datetime( $event_end, $date_format, $time_format ) ); ?>
		</div>
	<?php endif; ?>

	<?php if ( $event_all_day ) : ?>
		<div class="event-all-day">
			<strong><?php esc_html_e( 'All Day Event', 'fair-events' ); ?></strong>
		</div>
	<?php endif; ?>
</div>
