<?php
/**
 * Seed category-backed Select One and Multiselect questions (#1999).
 *
 * Creates a small category tree, uniquely suffixed per run:
 *
 *   E2E Cats {suffix}
 *   ├── Alpha {suffix}
 *   └── Beta {suffix}
 *       └── Gamma {suffix}
 *   E2E Empty {suffix}   (no subcategories)
 *
 * and two published posts using it:
 *
 * - a page with a standalone Fair Form: a required Select One over the
 *   subcategories of "E2E Cats" (with a typed option that must stay hidden),
 *   a Conditional Section shown when it equals "Alpha", a required
 *   Multiselect over the same scope, an empty-group Multiselect, a Select One
 *   whose parent no longer exists, and a Select One over every category;
 * - a free event whose Event Signup nests a Multiselect over the same scope
 *   and a Conditional Section shown when it contains "Alpha".
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-fair-form-category-options.php
 *
 * Prints a single `E2E_FAIR_FORM_CATEGORY_OPTIONS:{json}` line. Tear down the
 * page with cleanup-fair-form-notification-page.php, the event with
 * cleanup-event.php, and the categories with `wp term delete category`.
 *
 * @package FairFormE2E
 */

use FairEvents\Models\EventDates;
use FairEvents\Models\TicketSalePeriod;
use FairEvents\Models\TicketType;
use FairEvents\Models\TicketPrice;

defined( 'ABSPATH' ) || exit;

$suffix = gmdate( 'His' ) . wp_rand( 100, 999 );

/**
 * Insert a category or stop the seed.
 *
 * @param string $name      Category name.
 * @param int    $parent_id Parent term ID.
 * @return int Term ID.
 */
$insert_category = static function ( $name, $parent_id = 0 ) {
	$term = wp_insert_term( $name, 'category', array( 'parent' => $parent_id ) );
	if ( is_wp_error( $term ) ) {
		WP_CLI::error( 'Failed to create category: ' . $term->get_error_message() );
	}
	return (int) $term['term_id'];
};

$category_names = array(
	'parent' => 'E2E Cats ' . $suffix,
	'alpha'  => 'Alpha ' . $suffix,
	'beta'   => 'Beta ' . $suffix,
	'gamma'  => 'Gamma ' . $suffix,
	'empty'  => 'E2E Empty ' . $suffix,
);

$ids           = array();
$ids['parent'] = $insert_category( $category_names['parent'] );
$ids['alpha']  = $insert_category( $category_names['alpha'], $ids['parent'] );
$ids['beta']   = $insert_category( $category_names['beta'], $ids['parent'] );
$ids['gamma']  = $insert_category( $category_names['gamma'], $ids['beta'] );
$ids['empty']  = $insert_category( $category_names['empty'] );

// A term ID that no category uses: the parent of a deleted category.
$missing_parent_id = (int) $ids['empty'] + 100000;

$block = static function ( $name, array $attributes, $inner = null ) {
	$open = '<!-- wp:' . $name . ( $attributes ? ' ' . wp_json_encode( $attributes ) : '' );
	return null === $inner ? $open . ' /-->' : $open . ' -->' . $inner . '<!-- /wp:' . $name . ' -->';
};

$children = array(
	'optionSource'     => 'categoryChildren',
	'parentCategoryId' => $ids['parent'],
);

$page_content = $block(
	'fair-form/fair-form',
	array(
		'formId'    => 'e2e-category-options',
		'formTitle' => 'E2E Category Options',
	),
	implode(
		'',
		array(
			$block(
				'fair-form/fair-form-select-one',
				array(
					'questionKey'  => 'workshop',
					'questionText' => 'Which workshop?',
					'required'     => true,
				) + $children,
				$block( 'fair-form/fair-form-option', array( 'value' => 'Typed leftover' ) )
			),
			$block(
				'fair-form/fair-form-conditional',
				array(
					'conditionQuestionKey' => 'workshop',
					'conditionOperator'    => 'equals',
					'conditionValue'       => $category_names['alpha'],
				),
				$block(
					'fair-form/fair-form-short-text',
					array(
						'questionKey'  => 'alpha_note',
						'questionText' => 'Alpha note',
					)
				)
			),
			$block(
				'fair-form/fair-form-multiselect',
				array(
					'questionKey'  => 'topics',
					'questionText' => 'Which topics?',
					'required'     => true,
				) + $children,
				$block( 'fair-form/fair-form-option', array( 'value' => 'Typed topic' ) )
			),
			$block(
				'fair-form/fair-form-multiselect',
				array(
					'questionKey'      => 'empty_group',
					'questionText'     => 'Empty group',
					'optionSource'     => 'categoryChildren',
					'parentCategoryId' => $ids['empty'],
				)
			),
			$block(
				'fair-form/fair-form-select-one',
				array(
					'questionKey'      => 'missing_parent',
					'questionText'     => 'Missing parent',
					'optionSource'     => 'categoryChildren',
					'parentCategoryId' => $missing_parent_id,
				)
			),
			$block(
				'fair-form/fair-form-select-one',
				array(
					'questionKey'  => 'any_category',
					'questionText' => 'Any category',
					'optionSource' => 'categories',
				)
			),
		)
	)
);

$page_id = wp_insert_post(
	array(
		'post_type'    => 'page',
		'post_status'  => 'publish',
		'post_title'   => 'E2E Category Options ' . $suffix,
		'post_content' => $page_content,
	),
	true
);

if ( is_wp_error( $page_id ) ) {
	WP_CLI::error( 'Failed to create page: ' . $page_id->get_error_message() );
}

$event_content = $block(
	'fair-events/event-signup',
	array(),
	$block(
		'fair-form/fair-form-multiselect',
		array(
			'questionKey'  => 'signup_topics',
			'questionText' => 'Signup topics',
			'required'     => true,
		) + $children
	) . $block(
		'fair-form/fair-form-conditional',
		array(
			'conditionQuestionKey' => 'signup_topics',
			'conditionOperator'    => 'contains',
			'conditionValue'       => $category_names['alpha'],
		),
		$block(
			'fair-form/fair-form-short-text',
			array(
				'questionKey'  => 'signup_alpha_note',
				'questionText' => 'Signup alpha note',
			)
		)
	)
);

$event_id = wp_insert_post(
	array(
		'post_type'    => 'fair_event',
		'post_status'  => 'publish',
		'post_title'   => 'E2E Category Options Event ' . $suffix,
		'post_content' => $event_content,
	),
	true
);

if ( is_wp_error( $event_id ) ) {
	WP_CLI::error( 'Failed to create event: ' . $event_id->get_error_message() );
}

$event_date_id = EventDates::save_occurrence(
	$event_id,
	gmdate( 'Y-m-d H:i:s', strtotime( '+7 days' ) ),
	gmdate( 'Y-m-d H:i:s', strtotime( '+7 days +2 hours' ) ),
	false,
	'single'
);

if ( ! $event_date_id ) {
	WP_CLI::error( 'Failed to create event date.' );
}

$sale_period_id = TicketSalePeriod::create(
	$event_date_id,
	'Standard',
	gmdate( 'Y-m-d H:i:s', strtotime( '-1 day' ) ),
	gmdate( 'Y-m-d H:i:s', strtotime( '+30 days' ) ),
	0
);
$ticket_type_id = $sale_period_id ? TicketType::create( $event_date_id, 'General Admission', null, 0 ) : 0;

if ( ! $ticket_type_id || ! TicketPrice::create( $ticket_type_id, $sale_period_id, 0.0, null ) ) {
	WP_CLI::error( 'Failed to create the free ticket.' );
}

echo 'E2E_FAIR_FORM_CATEGORY_OPTIONS:' . wp_json_encode(
	array(
		'pageId'          => (int) $page_id,
		'pageUrl'         => get_permalink( $page_id ),
		'eventId'         => (int) $event_id,
		'eventDateId'     => (int) $event_date_id,
		'eventUrl'        => get_permalink( $event_id ),
		'categoryIds'     => $ids,
		'categoryNames'   => $category_names,
		'missingParentId' => $missing_parent_id,
	)
) . "\n";
