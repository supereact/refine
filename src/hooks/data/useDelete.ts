import { useContext } from "react";
import { useQueryClient, useMutation, UseMutationResult } from "react-query";

import { DataContext } from "@contexts/data";
import {
    DeleteOneResponse,
    IDataContext,
    MutationMode,
    GetListResponse,
    QueryResponse,
    Context as DeleteContext,
    BaseRecord,
    ContextQuery,
} from "@interfaces";

import {
    useMutationMode,
    useCancelNotification,
    useCacheQueries,
} from "@hooks";

type DeleteParams = {
    id: string | number;
};

type UseDeleteReturnType = UseMutationResult<
    DeleteOneResponse,
    unknown,
    DeleteParams,
    DeleteContext
>;

export const useDelete = (
    resource: string,
    mutationModeProp?: MutationMode,
    onCancel?: (cancelMutation: () => void) => void,
): UseDeleteReturnType => {
    const queryClient = useQueryClient();
    const { deleteOne } = useContext<IDataContext>(DataContext);
    const { mutationMode: mutationModeContext } = useMutationMode();
    const cancelNotification = useCancelNotification();

    const mutationMode = mutationModeProp ?? mutationModeContext;

    if (!resource) {
        throw new Error("'resource' is required for useDelete hook.");
    }

    const getAllQueries = useCacheQueries(resource);

    const mutation = useMutation<
        DeleteOneResponse,
        unknown,
        DeleteParams,
        DeleteContext
    >(
        ({ id }) => {
            if (!(mutationMode === "undoable")) {
                return deleteOne(resource, id);
            }

            const updatePromise = new Promise<DeleteOneResponse>(
                (resolve, reject) => {
                    const updateTimeout = setTimeout(() => {
                        resolve(deleteOne(resource, id));
                    }, 5000);

                    const cancelMutation = () => {
                        clearTimeout(updateTimeout);
                        reject("mutation cancelled");
                    };

                    if (onCancel) {
                        onCancel(cancelMutation);
                    } else {
                        cancelNotification(cancelMutation);
                    }
                },
            );
            return updatePromise;
        },
        {
            onMutate: async (deleteParams) => {
                const previousQueries: ContextQuery[] = [];

                const allQueries = getAllQueries(deleteParams.id.toString());

                for (const queryItem of allQueries) {
                    const { queryKey } = queryItem;
                    await queryClient.cancelQueries(queryKey);

                    const previousQuery = queryClient.getQueryData<QueryResponse>(
                        queryKey,
                    );

                    if (previousQuery) {
                        previousQueries.push({
                            query: previousQuery,
                            queryKey,
                        });

                        if (queryKey.includes(`resource/list/${resource}`)) {
                            const {
                                data,
                                total,
                            } = previousQuery as GetListResponse;

                            queryClient.setQueryData(queryKey, {
                                ...previousQuery,
                                data: (data ?? []).filter(
                                    (record: BaseRecord) =>
                                        !(
                                            record.id.toString() ===
                                            deleteParams.id.toString()
                                        ),
                                ),
                                total: total - 1,
                            });
                        } else {
                            queryClient.removeQueries(queryKey);
                        }
                    }
                }

                return {
                    previousQueries: previousQueries,
                };
            },
            onError: (_err, _variables, context) => {
                if (context) {
                    for (const query of context.previousQueries) {
                        queryClient.setQueryData(query.queryKey, query.query);
                    }
                }
            },
            onSettled: (_data, _error, variables) => {
                const allQueries = getAllQueries(variables.id.toString());
                for (const query of allQueries) {
                    queryClient.invalidateQueries(query.queryKey);
                }
            },
        },
    );

    return mutation;
};
