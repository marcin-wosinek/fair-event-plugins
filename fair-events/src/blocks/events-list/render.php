<?php
/**
 * Events List Block - Server-side rendering
 *
 * @package FairEvents
 *
 * @var array    $attributes Block attributes.
 * @var string   $content    Block default content.
 * @var WP_Block $block      Block instance.
 */

defined( 'WPINC' ) || die;

use FairEvents\Helpers\EventsListSeries;
use FairEvents\Helpers\OccurrenceFields;
use FairEvents\Helpers\PatternResolver;
use FairEvents\Settings\Settings;
use FairEvents\Services\EventFeedProvider;

// Get block attributes.
$time_filter        = $attributes['timeFilter'] ?? 'upcoming';
$categories         = $attributes['categories'] ?? array();
$display_pattern    = $attributes['displayPattern'] ?? 'default';
$event_source_slugs = $attributes['eventSources'] ?? array();

$current_time = current_time( 'Y-m-d H:i:s' );

// Time filter → [ range_start, range_end ] for the per-event provider path,
// and the equivalent fair_events_date_query args for the Query Loop path.
// Both share the same boundary rules: "upcoming" is start >= now, "ongoing"
// is start <= now <= effective end, "past" is effective end < now, and a
// missing end is treated as equal to start (QueryHelper::filter_by_dates()
// and EventFeedProvider's underlying EventDates::get_for_date_range() both
// apply that same fallback).
switch ( $time_filter ) {
	case 'upcoming':
		$range_start            = $current_time;
		$range_end              = null;
		$query_args_date_filter = array( 'start_after' => $current_time );
		$query_order            = 'ASC';
		break;

	case 'past':
		$range_start            = null;
		$range_end              = $current_time;
		$query_args_date_filter = array( 'end_before' => $current_time );
		$query_order            = 'DESC';
		break;

	case 'ongoing':
		$range_start            = $current_time;
		$range_end              = $current_time;
		$query_args_date_filter = array(
			'start_before' => $current_time,
			'end_after'    => $current_time,
		);
		$query_order            = 'ASC';
		break;

	case 'all':
	default:
		$range_start            = null;
		$range_end              = null;
		$query_args_date_filter = true;
		$query_order            = 'ASC';
		break;
}

$resolved = PatternResolver::resolve( $display_pattern );

// Hook in the QueryHelper filters for the Query Loop path. Registered
// unconditionally (and always removed below) so a Query Loop pattern nested
// inside another block on the page never picks up a stale filter left behind
// by an earlier, differently-configured events-list block.
add_filter( 'posts_join', array( 'FairEvents\\Helpers\\QueryHelper', 'join_dates_table' ), 10, 2 );
add_filter( 'posts_where', array( 'FairEvents\\Helpers\\QueryHelper', 'filter_by_dates' ), 10, 2 );
add_filter( 'posts_groupby', array( 'FairEvents\\Helpers\\QueryHelper', 'group_by_post' ), 10, 2 );
add_filter( 'posts_orderby', array( 'FairEvents\\Helpers\\QueryHelper', 'order_by_dates' ), 10, 2 );

$query_args = array(
	'post_type'              => Settings::get_enabled_post_types(),
	'posts_per_page'         => -1,
	'fair_events_date_query' => $query_args_date_filter,
	'fair_events_order'      => $query_order,
);

if ( ! empty( $categories ) ) {
	// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query
	$query_args['tax_query'] = array(
		array(
			'taxonomy'         => 'category',
			'field'            => 'term_id',
			'terms'            => $categories,
			'include_children' => false,
		),
	);
}

$query_loop_filter_callback = function ( $query, $block ) use ( $query_args ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed -- $block is part of the query_loop_block_query_vars filter signature.
	$enabled_post_types = Settings::get_enabled_post_types();
	$query_post_type    = $query['post_type'] ?? '';

	$is_event_query = is_array( $query_post_type )
		? ! empty( array_intersect( $query_post_type, $enabled_post_types ) )
		: in_array( $query_post_type, $enabled_post_types, true );

	if ( $is_event_query ) {
		$query['fair_events_date_query'] = $query_args['fair_events_date_query'];
		$query['fair_events_order']      = $query_args['fair_events_order'];
		if ( isset( $query_args['tax_query'] ) ) {
			// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query
			$query['tax_query'] = $query_args['tax_query'];
		}
	}

	return $query;
};

add_filter( 'query_loop_block_query_vars', $query_loop_filter_callback, 10, 2 );

$events_query = null;
$occurrences  = array();

if ( PatternResolver::TYPE_QUERY_LOOP === $resolved['type'] ) {
	$events_query = new WP_Query( $query_args );
} elseif ( PatternResolver::TYPE_PER_EVENT === $resolved['type'] ) {
	$occurrences = ( new EventFeedProvider() )->get_occurrences(
		$range_start,
		$range_end,
		array(
			'categories'         => $categories,
			'event_source_slugs' => is_array( $event_source_slugs ) ? $event_source_slugs : array(),
		)
	);

	// The provider sorts ascending; 'past' displays most recent first.
	if ( 'past' === $time_filter ) {
		$occurrences = array_reverse( $occurrences );
	}

	if ( 'upcoming' === $time_filter ) {
		$occurrences = EventsListSeries::upcoming( $occurrences, $current_time );
	}
}
?>

<div <?php echo wp_kses_post( get_block_wrapper_attributes() ); ?>>
	<?php if ( PatternResolver::TYPE_UNAVAILABLE === $resolved['type'] ) : ?>
		<p class="events-list-unavailable-pattern">
			<?php esc_html_e( 'The selected display pattern is no longer available. Choose a different pattern to display these events.', 'fair-events' ); ?>
		</p>
	<?php elseif ( PatternResolver::TYPE_QUERY_LOOP === $resolved['type'] ) : ?>
		<?php if ( $events_query->have_posts() ) : ?>
			<?php
			EventsListSeries::push_context(
				array(
					'mode'        => EventsListSeries::MODE_QUERY_LOOP,
					'time_filter' => $time_filter,
					'now'         => $current_time,
				)
			);
			$parsed_blocks = parse_blocks( $resolved['content'] );
			foreach ( $parsed_blocks as $parsed_block ) {
				echo wp_kses_post( render_block( $parsed_block ) );
			}
			EventsListSeries::pop_context();
			?>
		<?php else : ?>
			<p class="no-events">
				<?php esc_html_e( 'No events found.', 'fair-events' ); ?>
			</p>
		<?php endif; ?>
	<?php elseif ( empty( $occurrences ) ) : ?>
		<p class="no-events">
			<?php esc_html_e( 'No events found.', 'fair-events' ); ?>
		</p>
	<?php else : ?>
		<?php
		foreach ( $occurrences as $occurrence ) {
			$is_external_source = in_array( $occurrence['source'], array( 'ical', 'api' ), true );

			$event_classes = array( 'event-list-item' );
			$event_style   = '';

			if ( $is_external_source ) {
				$event_classes[] = 'is-ical';
				$event_color     = ! empty( $occurrence['source_color'] ) ? $occurrence['source_color'] : '#4caf50';

				if ( preg_match( '/^#[0-9A-Fa-f]{3,6}$/', $event_color ) ) {
					$bg_color_value = $event_color;
				} else {
					$bg_color_value = 'var(--wp--preset--color--' . esc_attr( $event_color ) . ')';
				}

				$event_style = '--event-bg-color: ' . $bg_color_value . '; --event-text-color: #ffffff;';
			} elseif ( 'standalone' === $occurrence['source'] ) {
				$event_classes[] = 'is-standalone';
			} else {
				$event_classes[] = 'is-wordpress';
			}

			if ( ! empty( $occurrence['is_draft'] ) ) {
				$event_classes[] = 'is-draft';
			}

			echo '<div class="' . esc_attr( implode( ' ', $event_classes ) ) . '"' . ( '' !== $event_style ? ' style="' . esc_attr( $event_style ) . '"' : '' ) . '>';

			$is_post_occurrence = 'post' === $occurrence['source'] && ! empty( $occurrence['event_id'] );

			if ( $is_post_occurrence ) {
				// Retain post context so a per-event pattern can also use
				// native post blocks (wp:post-title, wp:post-featured-image, …)
				// alongside the {{token}} placeholders.
				// phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited
				$GLOBALS['post'] = get_post( $occurrence['event_id'] );
				setup_postdata( $GLOBALS['post'] );
			}

			EventsListSeries::push_context(
				array(
					'mode'        => EventsListSeries::MODE_OCCURRENCE,
					'time_filter' => $time_filter,
					'occurrence'  => $occurrence,
				)
			);
			$occurrence_content = OccurrenceFields::render( $occurrence, $resolved['content'] );
			$parsed_blocks      = parse_blocks( $occurrence_content );
			foreach ( $parsed_blocks as $parsed_block ) {
				echo wp_kses_post( render_block( $parsed_block ) );
			}
			EventsListSeries::pop_context();

			if ( $is_post_occurrence ) {
				wp_reset_postdata();
			}

			echo '</div>';
		}
		?>
	<?php endif; ?>
</div>

<?php
remove_filter( 'posts_join', array( 'FairEvents\\Helpers\\QueryHelper', 'join_dates_table' ), 10 );
remove_filter( 'posts_where', array( 'FairEvents\\Helpers\\QueryHelper', 'filter_by_dates' ), 10 );
remove_filter( 'posts_groupby', array( 'FairEvents\\Helpers\\QueryHelper', 'group_by_post' ), 10 );
remove_filter( 'posts_orderby', array( 'FairEvents\\Helpers\\QueryHelper', 'order_by_dates' ), 10 );
remove_filter( 'query_loop_block_query_vars', $query_loop_filter_callback, 10 );

wp_reset_postdata();
