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

// Get event data from custom table
$event_dates = \FairEvents\Models\EventDates::get_by_event_id( $post_id );

// Don't render if no event data
if ( ! $event_dates ) {
	return '';
}

$event_start   = $event_dates->start_datetime;
$event_end     = $event_dates->end_datetime;
$event_all_day = $event_dates->all_day;

$formatted_date = \FairEvents\Helpers\DateRangeFormatter::format( $event_start, $event_end, $event_all_day );
?>

<div <?php echo wp_kses_post( get_block_wrapper_attributes( array( 'class' => 'event-dates' ) ) ); ?>>
	<?php echo esc_html( $formatted_date ); ?>
</div>
