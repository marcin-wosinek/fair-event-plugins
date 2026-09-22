<?php
/**
 * Event Prices Block - Server-side rendering
 *
 * @package FairEvents
 *
 * @var array    $attributes Block attributes.
 * @var string   $content    Block default content.
 * @var WP_Block $block      Block instance.
 */

defined( 'WPINC' ) || die;

// Get post ID from block context.
$post_id = $block->context['postId'] ?? get_the_ID();

// The block-renderer REST route (`wp/v2/block-renderer`) is how the editor's
// ServerSideRender fetches this preview; every genuine front-end render goes
// through render_block() directly and never hits REST. Used below to show an
// explanatory placeholder to editors only — the published output stays
// silently empty when there's nothing to show, matching how the Event Info
// block degrades.
$is_editor_preview = defined( 'REST_REQUEST' ) && REST_REQUEST;

if ( ! $post_id || ! class_exists( \FairEvents\Helpers\SelectedOccurrence::class ) ) {
	return '';
}

// Honors ?event_date=<id> the same way the Event Info block does, so a
// viewer who picks a specific occurrence from the signup dropdown sees that
// occurrence's pricing here too.
$event_dates = \FairEvents\Helpers\SelectedOccurrence::resolve( $post_id );

if ( ! $event_dates ) {
	if ( $is_editor_preview ) {
		return '<p class="wp-block-fair-events-event-prices__editor-placeholder">'
			. esc_html__( 'Event Prices block is disabled — no event is linked to this post.', 'fair-events' )
			. '</p>';
	}
	return '';
}

// Pivot to the series master for generated occurrences — pricing lives
// there, same as event-signup/render.php and EventSchema::get_jsonld_offers().
$pricing_event_date_id = (int) $event_dates->id;
if ( 'generated' === $event_dates->occurrence_type && ! empty( $event_dates->master_id ) ) {
	$pricing_event_date_id = (int) $event_dates->master_id;
}

if ( ! class_exists( \FairEvents\Services\EventPricingSchedule::class ) ) {
	return '';
}

$schedule = \FairEvents\Services\EventPricingSchedule::build_for_event_date( $pricing_event_date_id );

if ( ! $schedule['has_prices'] ) {
	if ( $is_editor_preview ) {
		return '<p class="wp-block-fair-events-event-prices__editor-placeholder">'
			. esc_html__( 'Event Prices block is disabled — no public prices are configured for this event.', 'fair-events' )
			. '</p>';
	}
	return '';
}

$currency = class_exists( \FairEventsShared\Money::class ) ? \FairEventsShared\Money::site_currency() : 'EUR';

if ( ! function_exists( 'fair_events_format_sale_period_range' ) ) {
	/**
	 * Format an inclusive, site-formatted visitor-facing date range for a
	 * sale period. Sale periods use a half-open [sale_start, sale_end) range
	 * in the site timezone (sale_end is the first day no longer on sale), so
	 * the displayed end date is one day before the stored boundary.
	 *
	 * @param string $sale_start Resolved sale start datetime ('Y-m-d H:i:s').
	 * @param string $sale_end   Resolved sale end datetime ('Y-m-d H:i:s', exclusive).
	 * @return string Formatted date range, or '' if either boundary is unparsable.
	 */
	function fair_events_format_sale_period_range( $sale_start, $sale_end ) {
		$start_timestamp = \FairEvents\Helpers\DateHelper::local_to_timestamp( $sale_start );
		if ( false === $start_timestamp ) {
			return '';
		}

		$end_date = date_create( $sale_end, wp_timezone() );
		if ( ! $end_date ) {
			return '';
		}
		$end_date->modify( '-1 day' );
		$end_timestamp = $end_date->getTimestamp();

		$date_format = get_option( 'date_format' );
		$start_str   = wp_date( $date_format, $start_timestamp );
		$end_str     = wp_date( $date_format, $end_timestamp );

		if ( $start_str === $end_str ) {
			return $start_str;
		}

		/* translators: 1: sale period start date, 2: sale period end date */
		return sprintf( __( '%1$s – %2$s', 'fair-events' ), $start_str, $end_str );
	}
}

if ( ! function_exists( 'fair_events_format_price_entry' ) ) {
	/**
	 * Localized label for a ticket entry's state.
	 *
	 * @param array  $entry    Schedule entry (see EventPricingSchedule::build_schedule()).
	 * @param string $currency Site currency code.
	 * @return string Escaped-safe label text (caller still escapes on output).
	 */
	function fair_events_format_price_entry( $entry, $currency ) {
		switch ( $entry['state'] ) {
			case 'priced':
				return class_exists( \FairEventsShared\Money::class )
					? \FairEventsShared\Money::format_inline( $entry['price'], $currency )
					: (string) $entry['price'];
			case 'free':
				return __( 'Free', 'fair-events' );
			default:
				return __( 'Not available', 'fair-events' );
		}
	}
}
?>
<div <?php echo wp_kses_post( get_block_wrapper_attributes( array( 'class' => 'wp-block-fair-events-event-prices' ) ) ); ?>>
	<?php foreach ( $schedule['periods'] as $period ) : ?>
		<div class="wp-block-fair-events-event-prices__period">
			<?php if ( ! empty( $period['name'] ) ) : ?>
				<h3 class="wp-block-fair-events-event-prices__period-name"><?php echo esc_html( $period['name'] ); ?></h3>
			<?php endif; ?>
			<?php $range = fair_events_format_sale_period_range( $period['sale_start'], $period['sale_end'] ); ?>
			<?php if ( '' !== $range ) : ?>
				<div class="wp-block-fair-events-event-prices__period-dates"><?php echo esc_html( $range ); ?></div>
			<?php endif; ?>
			<dl class="wp-block-fair-events-event-prices__list">
				<?php foreach ( $period['entries'] as $entry ) : ?>
					<div class="wp-block-fair-events-event-prices__row wp-block-fair-events-event-prices__row--<?php echo esc_attr( $entry['state'] ); ?>">
						<dt class="wp-block-fair-events-event-prices__name">
							<?php echo esc_html( '' !== (string) $entry['name'] ? $entry['name'] : __( '(untitled ticket type)', 'fair-events' ) ); ?>
						</dt>
						<dd class="wp-block-fair-events-event-prices__price">
							<?php echo esc_html( fair_events_format_price_entry( $entry, $currency ) ); ?>
						</dd>
					</div>
				<?php endforeach; ?>
			</dl>
		</div>
	<?php endforeach; ?>
</div>
