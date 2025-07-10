/**
 * Simple Payment Block
 *
 * Block for displaying simple payment information.
 */

import { registerBlockType } from '@wordpress/blocks';
import { TextControl, SelectControl } from '@wordpress/components';
import { useBlockProps } from '@wordpress/block-editor';
import { __ } from '@wordpress/i18n';
import { Icon, payment } from '@wordpress/icons';

/**
 * Register the block
 */
registerBlockType('fair-payment/simple-payment-block', {
    title: __('Simple Payment', 'fair-payment'),
    description: __('Display simple payment information', 'fair-payment'),
    category: 'widgets',
    icon: <Icon icon={payment} />,
    supports: {
        html: false,
    },
    attributes: {
        amount: {
            type: 'string',
            default: '10',
        },
        currency: {
            type: 'string',
            default: 'EUR',
        },
    },
    
    /**
     * Block edit function
     */
    edit: ({ attributes, setAttributes }) => {
        const blockProps = useBlockProps({
            className: 'simple-payment-block',
        });
        
        const { amount, currency } = attributes;
        
        return (
            <div {...blockProps}>
                <div className="simple-payment-editor">
                    <h4>{__('Simple Payment Settings', 'fair-payment')}</h4>
                    <TextControl
                        label={__('Amount', 'fair-payment')}
                        value={amount}
                        onChange={(value) => setAttributes({ amount: value })}
                        type="number"
                    />
                    <SelectControl
                        label={__('Currency', 'fair-payment')}
                        value={currency}
                        options={[
                            { label: 'USD ($)', value: 'USD' },
                            { label: 'EUR (€)', value: 'EUR' },
                            { label: 'GBP (£)', value: 'GBP' },
                        ]}
                        onChange={(value) => setAttributes({ currency: value })}
                    />
                </div>
                <div className="simple-payment-preview">
                    <p>{__('Fair Payment:', 'fair-payment')} {amount} {currency}</p>
                </div>
            </div>
        );
    },
    
    /**
     * Block save function
     */
    save: ({ attributes }) => {
        const blockProps = useBlockProps.save({
            className: 'simple-payment-block',
        });
        
        const { amount, currency } = attributes;
        
        return (
            <div {...blockProps}>
                <p className="simple-payment-text">
                    {__('Fair Payment:', 'fair-payment')} {amount} {currency}
                </p>
            </div>
        );
    },
});
