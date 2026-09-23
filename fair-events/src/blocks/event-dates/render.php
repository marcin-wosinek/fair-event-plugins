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

// Get post ID from block context.
$event_post_id = $block->context['postId'] ?? get_the_ID();

// Inside an Events List, show the occurrence (or recurring-series summary)
// the list selected rather than resolving one independently.
$list_date_text = \FairEvents\Helpers\EventsListSeries::date_text_for_nested_block( (int) $event_post_id );

if ( null !== $list_date_text ) {
	if ( '' === $list_date_text ) {
		return '';
	}
	?>
	<div <?php echo wp_kses_post( get_block_wrapper_attributes( array( 'class' => 'event-dates' ) ) ); ?>>
		<?php echo esc_html( $list_date_text ); ?>
	</div>
	<?php
	return;
}

// Only render if we have a post ID.
if ( ! $event_post_id ) {
	return '';
}

// Get event data from custom table. Honors ?event_date=<id> so a viewer
// who picks a specific occurrence from the signup dropdown sees that
// occurrence's date here too.
$event_dates = \FairEvents\Helpers\SelectedOccurrence::resolve( $event_post_id );

// Don't render if no event data.
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
